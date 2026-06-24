(function () {
  const APP_VERSION = "20260625-major-info";
  const data = window.SX_DATA || { admissions: [], segments: {}, sources: [], rules: {}, controlLines: {} };
  let importedRows = [];
  let builtInPlanRows = null;
  let builtInAdmissionRows = null;
  let builtInMajorRows = null;
  let planLoadPromise = null;
  let admissionLoadPromise = null;
  let majorLoadPromise = null;
  let currentTier = "all";
  let currentResults = [];
  let resultCounts = {};
  let plan = loadPlan();

  const $ = (id) => document.getElementById(id);

  const els = {
    track: $("track"),
    score: $("score"),
    rank: $("rank"),
    batch: $("batch"),
    schoolKeyword: $("schoolKeyword"),
    majorKeyword: $("majorKeyword"),
    cityKeyword: $("cityKeyword"),
    riskMode: $("riskMode"),
    runBtn: $("runBtn"),
    resetBtn: $("resetBtn"),
    rankOut: $("rankOut"),
    underLineOut: $("underLineOut"),
    specialLineOut: $("specialLineOut"),
    advice: $("advice"),
    dataBadge: $("dataBadge"),
    results: $("results"),
    resultMeta: $("resultMeta"),
    csvFile: $("csvFile"),
    importStatus: $("importStatus"),
    planList: $("planList"),
    planCount: $("planCount"),
    exportBtn: $("exportBtn"),
    clearPlanBtn: $("clearPlanBtn"),
    downloadTemplateBtn: $("downloadTemplateBtn"),
    sources: $("sources")
  };

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "--";
    return Number(value).toLocaleString("zh-CN");
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function scoreToRank(track, score) {
    const table = data.segments?.[track] || [];
    if (!score) return null;
    const exact = table.find((row) => row.score === Number(score));
    if (exact) return exact.cumulative;
    const lower = table.filter((row) => row.score <= Number(score)).sort((a, b) => b.score - a.score)[0];
    return lower ? lower.cumulative : null;
  }

  function getControls(track) {
    return data.controlLines?.["2025"]?.[track] || {};
  }

  function mapTrackToLegacy(track) {
    return track === "physical" ? "理工" : "文史";
  }

  function mapBatch(value) {
    if (value === "本科") return ["本科一批", "本科二批", "本科", "本科批"];
    return ["高职专科", "高职（专科）", "专科"];
  }

  function classify(row, userRank, userScore, mode) {
    const minRank = Number(row.minRank || 0);
    const minScore = Number(row.minScore || 0);
    if (!minRank && !minScore && Number(row.plan || 0)) {
      return riskResult("计划", 0, 0, "2026 招生计划暂无录取分/位次，需结合 2025 录取线判断");
    }
    if (!minRank || !userRank) {
      const diff = userScore - minScore;
      const windows = scoreWindows(mode);
      if (diff < windows.rush[0]) return riskResult("高风险", diff, diff, `分差 ${diff}`);
      if (diff < windows.rush[1]) return riskResult("冲", diff, Math.abs(diff - 0), `分差 ${signed(diff)}`);
      if (diff < windows.stable[1]) return riskResult("稳", diff, Math.abs(diff - 18), `分差 ${signed(diff)}`);
      if (diff <= windows.safe[1]) return riskResult("保", diff, Math.abs(diff - 38), `分差 ${signed(diff)}`);
      return riskResult("过低", diff, Math.abs(diff - 38), `分差 +${diff}`);
    }

    const margin = minRank - userRank;
    const ratio = margin / Math.max(userRank, 1);
    const windows = rankWindows(mode);

    if (ratio < windows.rush[0]) return riskResult("高风险", margin, ratio, `位次差 ${formatNumber(margin)}`);
    if (ratio < windows.rush[1]) return riskResult("冲", margin, Math.abs(ratio - 0), `位次差 ${formatRankMargin(margin)}`);
    if (ratio < windows.stable[1]) return riskResult("稳", margin, Math.abs(ratio - 0.11), `位次差 ${formatRankMargin(margin)}`);
    if (ratio <= windows.safe[1]) return riskResult("保", margin, Math.abs(ratio - 0.28), `位次差 ${formatRankMargin(margin)}`);
    return riskResult("过低", margin, Math.abs(ratio - 0.28), `位次差 +${formatNumber(margin)}`);
  }

  function rankWindows(mode) {
    if (mode === "bold") {
      return { rush: [-0.12, 0.08], stable: [0.08, 0.22], safe: [0.22, 0.50] };
    }
    if (mode === "safe") {
      return { rush: [-0.04, 0.02], stable: [0.02, 0.16], safe: [0.16, 0.38] };
    }
    return { rush: [-0.08, 0.05], stable: [0.05, 0.20], safe: [0.20, 0.45] };
  }

  function scoreWindows(mode) {
    if (mode === "bold") {
      return { rush: [-15, 10], stable: [10, 34], safe: [34, 62] };
    }
    if (mode === "safe") {
      return { rush: [-6, 6], stable: [6, 26], safe: [26, 48] };
    }
    return { rush: [-10, 8], stable: [8, 30], safe: [30, 55] };
  }

  function riskResult(tier, margin, sortScore, reason) {
    return { tier, margin, sortScore, reason };
  }

  function signed(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function formatRankMargin(value) {
    return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
  }

  async function loadBuiltInPlans() {
    if (builtInPlanRows) return builtInPlanRows;
    if (planLoadPromise) return planLoadPromise;
    planLoadPromise = (async () => {
      els.dataBadge.textContent = "加载计划中";
      const response = await fetch(`data/plan-2026.js?v=${APP_VERSION}`, { cache: "force-cache" });
      if (!response.ok) throw new Error("2026 招生计划加载失败");
      builtInPlanRows = parseJsPayload(await response.text()).map(normalizePlanRecord);
      return builtInPlanRows;
    })();
    return planLoadPromise;
  }

  async function loadBuiltInAdmissions() {
    if (builtInAdmissionRows) return builtInAdmissionRows;
    if (admissionLoadPromise) return admissionLoadPromise;
    admissionLoadPromise = (async () => {
      els.dataBadge.textContent = "加载2025录取线";
      const response = await fetch(`data/admission-2025.js?v=${APP_VERSION}`, { cache: "force-cache" });
      if (!response.ok) throw new Error("2025 院校专业组录取线加载失败");
      builtInAdmissionRows = parseJsPayload(await response.text()).map(normalizeAdmissionRecord);
      return builtInAdmissionRows;
    })();
    return admissionLoadPromise;
  }

  async function loadBuiltInMajors() {
    if (builtInMajorRows) return builtInMajorRows;
    if (majorLoadPromise) return majorLoadPromise;
    majorLoadPromise = (async () => {
      els.dataBadge.textContent = "加载专业录取线";
      const response = await fetch(`data/major-2025.js?v=${APP_VERSION}`, { cache: "force-cache" });
      if (!response.ok) throw new Error("2025 专业录取线加载失败");
      builtInMajorRows = parseJsPayload(await response.text()).map(normalizeAdmissionRecord);
      return builtInMajorRows;
    })();
    return majorLoadPromise;
  }

  function parseJsPayload(text) {
    const start = text.indexOf("=");
    const payload = start >= 0 ? text.slice(start + 1).trim().replace(/;\s*$/, "") : "[]";
    return JSON.parse(payload);
  }

  async function getCandidateRows(track, batchValue) {
    const imported = importedRows.filter((row) => row.track === track || !row.track);
    const admissions2025 = (await loadBuiltInAdmissions()).filter((row) => row.track === track || !row.track);
    const majorRows = els.majorKeyword.value.trim()
      ? (await loadBuiltInMajors()).filter((row) => row.track === track || !row.track)
      : [];
    const builtInPlans = (await loadBuiltInPlans()).filter((row) => row.track === track || !row.track);
    const historical2024 = data.admissions
      .filter((row) => row.subject === mapTrackToLegacy(track))
      .map((row) => ({
        id: `official-${row.year}-${row.batch}-${row.schoolCode}-${row.subject}`,
        year: row.year,
        school: row.school,
        schoolCode: row.schoolCode,
        group: "",
        major: "",
        subject: row.subject,
        track,
        batch: row.batch,
        plan: row.plan,
        filed: row.filed,
        minScore: row.minScore,
        minRank: row.minRank,
        city: "",
        source: row.sourceTitle || "陕西招生考试信息网官方投档表",
        sourceUrl: row.sourceUrl,
        dataType: "2024 官方投档历史参考"
      }));

    const batchNames = mapBatch(batchValue);
    const primaryRows = [...imported, ...admissions2025, ...majorRows, ...builtInPlans]
      .filter((row) => batchNames.some((name) => String(row.batch || "").includes(name)));
    const historicalRows = historical2024.filter((row) => batchNames.some((name) => String(row.batch || "").includes(name)));
    return { primaryRows, historicalRows };
  }

  function normalizeAdmissionRecord(record) {
    return {
      id: record.id,
      year: record.year || "2025",
      school: record.school || "",
      schoolCode: record.schoolCode || "",
      group: record.group || "",
      major: record.major || "",
      majorCode: record.majorCode || "",
      subjectReq: record.subjectReq || "",
      admissionType: record.admissionType || "",
      note: record.note || "",
      duration: record.duration || record["学制"] || "",
      tuition: record.tuition || record["学费"] || "",
      tags: record.tags || "",
      track: record.track || "",
      batch: record.batch || "本科批",
      plan: toNumber(record.plan),
      countLabel: record.countLabel || "录取数",
      minScore: toNumber(record.minScore),
      minRank: toNumber(record.minRank),
      city: record.city || "",
      schoolType: record.schoolType || "",
      source: record.source || "22-25年全国高校在陕西的录取分数.xlsx",
      dataType: record.dataType || "2025 录取线"
    };
  }

  function normalizePlanRecord(record, index) {
    const subjectText = record.track || record["首选科目"] || record.subject || "";
    const track = subjectText === "history" || String(subjectText).includes("历史") || String(subjectText).includes("文史")
      ? "history"
      : subjectText === "physical" || String(subjectText).includes("物理") || String(subjectText).includes("理工")
        ? "physical"
        : "";
    return {
      id: record.id || `plan-2026-${index}`,
      year: record.year || record["年份"] || "2026",
      school: record.school || record["院校名称"] || "",
      schoolCode: record.schoolCode || record["院校代码"] || "",
      group: record.group || record["院校专业组"] || "",
      major: record.major || record["专业"] || "",
      track,
      batch: record.batch || record["批次"] || "本科",
      plan: toNumber(record.plan || record["计划数"]),
      countLabel: "计划数",
      minScore: toNumber(record.minScore || record["最低分"]),
      minRank: toNumber(record.minRank || record["最低位次"]),
      city: record.city || record["城市"] || "",
      subjectReq: record.subjectReq || record["再选科目"] || record.subject || "",
      majorCode: record.majorCode || record["专业代码"] || "",
      duration: record.duration || record["学制"] || "",
      tuition: record.tuition || record["学费"] || "",
      note: record.note || record["备注"] || "",
      source: record.source || record["来源"] || "2026 年普通高校在陕招生计划汇编 OCR",
      dataType: "2026 招生计划"
    };
  }

  function applyFilters(rows) {
    const schoolKey = normalizeText(els.schoolKeyword.value);
    const majorKey = normalizeText(els.majorKeyword.value);
    const cityKey = normalizeText(els.cityKeyword.value);

    return rows.filter((row) => {
      const schoolOk = !schoolKey || normalizeText(row.school).includes(schoolKey);
      const majorOk = !majorKey || normalizeText(`${row.major || ""} ${row.group || ""}`).includes(majorKey);
      const cityOk = !cityKey || normalizeText(`${row.city || ""} ${row.school || ""}`).includes(cityKey);
      return schoolOk && majorOk && cityOk;
    });
  }

  async function run() {
    const track = els.track.value;
    const score = Number(els.score.value);
    const enteredRank = Number(els.rank.value);
    const userRank = enteredRank || scoreToRank(track, score);
    const controls = getControls(track);
    const hasKeyword = [els.schoolKeyword.value, els.majorKeyword.value, els.cityKeyword.value].some((value) => value.trim());

    if (!score && !enteredRank && !hasKeyword) {
      els.advice.textContent = "请至少输入分数、位次或一个关键词。";
      return;
    }

    els.runBtn.disabled = true;
    els.runBtn.textContent = "生成中...";
    try {
      els.rankOut.textContent = formatNumber(userRank);
      els.underLineOut.textContent = score ? `${score - controls.undergraduate} 分` : "--";
      els.specialLineOut.textContent = score ? `${score - controls.special} 分` : "--";
      els.dataBadge.textContent = importedRows.length ? "已含导入数据" : "2025录取+2026计划";

      const candidates = await getCandidateRows(track, els.batch.value);
      let pool = applyFilters(candidates.primaryRows);
      if (!pool.length) pool = applyFilters(candidates.historicalRows);
      currentResults = pool
        .map((row) => ({ ...row, risk: classify(row, userRank, score, els.riskMode.value) }))
        .filter((row) => row.risk.tier !== "过低")
        .filter((row) => row.risk.tier !== "高风险" || els.riskMode.value === "bold")
        .sort(resultSort);
      resultCounts = countByTier(currentResults);

      els.advice.innerHTML = buildAdvice(track, score, userRank, controls);
      els.resultMeta.textContent = resultSummary();
      renderResults();
    } catch (error) {
      els.advice.textContent = error.message || "生成推荐时遇到问题。";
    } finally {
      els.runBtn.disabled = false;
      els.runBtn.textContent = "生成推荐";
    }
  }

  function resultSort(a, b) {
    const order = { "冲": 1, "稳": 2, "保": 3, "计划": 4, "高风险": 5 };
    return order[a.risk.tier] - order[b.risk.tier]
      || a.risk.sortScore - b.risk.sortScore
      || Number(b.year || 0) - Number(a.year || 0)
      || Number(b.minScore || 0) - Number(a.minScore || 0);
  }

  function countByTier(rows) {
    return rows.reduce((acc, row) => {
      acc[row.risk.tier] = (acc[row.risk.tier] || 0) + 1;
      return acc;
    }, {});
  }

  function resultSummary() {
    const parts = ["冲", "稳", "保", "计划"].map((tier) => `${tier}${resultCounts[tier] || 0}`);
    const hasMajor = currentResults.some((row) => row.dataType === "2025 专业录取线");
    const hasHistorical = currentResults.some((row) => row.dataType === "2024 官方投档历史参考");
    const detail = hasMajor ? "专业关键词已启用 2025 专业录取线。" : "推荐主依据为 2025 院校专业组录取线。";
    const fallback = hasHistorical ? "本次包含少量 2024 官方投档兜底参考。" : "2024 投档表仅在没有 2025/2026 匹配时兜底。";
    return `共筛出 ${currentResults.length} 条（${parts.join(" / ")}）。${detail}2026 招生计划用于核对可报专业和计划数。${fallback}`;
  }

  function buildAdvice(track, score, rank, controls) {
    const trackName = track === "physical" ? "物理" : "历史";
    if (!score) return `当前按你填写的位次 ${formatNumber(rank)} 推荐。建议同时填入分数，便于核对批次线差。`;
    const lineText = score >= controls.special
      ? "已超过特殊类型控制线，可重点拉开冲稳保梯度。"
      : score >= controls.undergraduate
        ? "已达到本科批次线，应优先保证稳和保的数量。"
        : "未达到 2025 本科线，建议重点查看高职专科或等待当年政策变化。";
    return `${trackName}类 ${score} 分，按 2025 陕西官方一分段估算位次约 ${formatNumber(rank)}。${lineText}`;
  }

  function renderResults() {
    const rows = visibleRows();
    if (!rows.length) {
      els.results.innerHTML = `<div class="empty">没有符合条件的结果。可以放宽关键词、换风险偏好，或导入更完整的院校专业组数据。</div>`;
      return;
    }

    els.results.innerHTML = rows.map((row) => `
      <article class="card">
        <div class="card-head">
          <div>
            <div class="school">${escapeHtml(row.school)}</div>
            <div class="card-note">${escapeHtml(cardSubtitle(row))}</div>
          </div>
          <span class="tier tier-${row.risk.tier}">${row.risk.tier}</span>
        </div>
        <dl>
          <div><dt>录取最低分</dt><dd>${formatAdmissionValue(row, "minScore")}</dd></div>
          <div><dt>录取最低位次</dt><dd>${formatAdmissionValue(row, "minRank")}</dd></div>
          <div><dt>${escapeHtml(row.countLabel || "计划数")}</dt><dd>${formatNumber(row.plan)}</dd></div>
          <div><dt>数据依据</dt><dd>${escapeHtml(row.dataType || row.year || "")}</dd></div>
        </dl>
        ${renderMajorInfo(row)}
        <div class="card-note">${escapeHtml(cardFootnote(row))}</div>
        <button class="add-btn" type="button" data-add="${escapeHtml(row.id)}">加入志愿表</button>
      </article>
    `).join("");
  }

  function renderMajorInfo(row) {
    const items = majorInfoItems(row);
    if (!items.length) return "";
    return `
      <div class="major-info" aria-label="专业信息">
        ${items.map((item) => `
          <div class="major-info-item${item.wide ? " major-info-wide" : ""}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function majorInfoItems(row) {
    return [
      { label: "院校代码", value: row.schoolCode },
      { label: "专业代码", value: row.majorCode },
      { label: "选科要求", value: row.subjectReq },
      { label: "招生类型", value: row.admissionType },
      { label: "学制", value: row.duration },
      { label: "学费", value: formatTuition(row.tuition) },
      { label: "院校性质", value: row.schoolType },
      { label: "备注", value: row.note, wide: true }
    ].filter((item) => item.value);
  }

  function formatTuition(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/元|免费|待定/.test(text)) return text;
    const number = toNumber(text);
    return number ? `${formatNumber(number)} 元/年` : text;
  }

  function formatAdmissionValue(row, field) {
    const value = Number(row[field] || 0);
    if (value > 0) return formatNumber(value);
    return isPlanOnly(row) ? "待录取" : "--";
  }

  function isPlanOnly(row) {
    return String(row.dataType || "").includes("招生计划") && !Number(row.minScore || 0) && !Number(row.minRank || 0);
  }

  function cardSubtitle(row) {
    return [
      row.group,
      row.major,
      row.city,
      row.tags
    ].filter(Boolean).join(" · ") || row.dataType;
  }

  function cardFootnote(row) {
    return [
      row.risk.reason,
      row.source || row.dataType || "自定义数据"
    ].filter(Boolean).join(" · ");
  }

  function visibleRows() {
    if (currentTier !== "all") {
      return currentResults.filter((row) => row.risk.tier === currentTier).slice(0, 180);
    }
    const tiers = ["冲", "稳", "保", "计划"];
    return tiers.flatMap((tier) => currentResults.filter((row) => row.risk.tier === tier).slice(0, 45));
  }

  function renderPlan() {
    els.planCount.textContent = `${plan.length} / 45`;
    if (!plan.length) {
      els.planList.innerHTML = `<div class="empty">还没有加入志愿。推荐结果里点“加入志愿表”即可排列。</div>`;
      return;
    }
    els.planList.innerHTML = plan.map((item, index) => `
      <div class="plan-item">
        <div class="plan-index">${index + 1}</div>
        <div>
          <strong>${escapeHtml(item.school)}</strong>
          <div class="card-note">${escapeHtml([item.group, item.major, item.batch, item.tier].filter(Boolean).join(" · "))}</div>
        </div>
        <button class="remove-btn" type="button" data-remove="${index}">移除</button>
      </div>
    `).join("");
  }

  function renderSources() {
    const localSources = [
      {
        title: "22-25年全国高校在陕西的院校录取分数.xlsx",
        usedFor: "2025 院校专业组最低分、最低位次，作为冲稳保主依据",
        accessed: "2026-06-25"
      },
      {
        title: "22-25年全国高校在陕西的专业录取分数.xlsx",
        usedFor: "2025 专业最低分、最低位次，用于专业关键词检索",
        accessed: "2026-06-25"
      },
      {
        title: "2026年历史类/物理类在陕招生计划.pdf",
        usedFor: "2026 招生计划，用于核对今年可报专业、专业组和计划数",
        accessed: "2026-06-24"
      }
    ];
    els.sources.innerHTML = [...localSources, ...(data.sources || [])].map((source) => `
      <div class="source-card">
        ${source.url
          ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>`
          : `<strong>${escapeHtml(source.title)}</strong>`}
        <div class="muted">${escapeHtml(source.usedFor)} · 访问日期：${escapeHtml(source.accessed)}</div>
      </div>
    `).join("");
  }

  function addToPlan(id) {
    if (plan.length >= 45) {
      alert("本科普通批参考容量为 45 个院校专业组，当前志愿表已满。");
      return;
    }
    const row = currentResults.find((item) => item.id === id);
    if (!row) return;
    plan.push({
      school: row.school,
      group: row.group,
      major: row.major,
      batch: row.batch,
      tier: row.risk.tier,
      minScore: row.minScore,
      minRank: row.minRank,
      dataType: row.dataType,
      source: row.source
    });
    savePlan();
    renderPlan();
  }

  function removeFromPlan(index) {
    plan.splice(index, 1);
    savePlan();
    renderPlan();
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quote = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quote && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quote = !quote;
      } else if (char === "," && !quote) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !quote) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(value);
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  function handleImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ""));
      const header = rows.shift()?.map((cell) => cell.trim()) || [];
      const get = (record, names) => {
        for (const name of names) {
          const index = header.findIndex((h) => h === name);
          if (index >= 0) return record[index];
        }
        return "";
      };

      importedRows = rows.map((record, index) => {
        const subjectText = get(record, ["首选科目", "科类", "选科", "track"]);
        const track = subjectText.includes("历史") || subjectText.includes("文史") ? "history" : subjectText.includes("物理") || subjectText.includes("理工") ? "physical" : "";
        return {
          id: `import-${Date.now()}-${index}`,
          year: get(record, ["年份", "year"]) || "导入",
          school: get(record, ["院校名称", "学校", "school"]),
          schoolCode: get(record, ["院校代码", "院校代号", "schoolCode"]),
          group: get(record, ["院校专业组", "专业组", "group"]),
          major: get(record, ["专业", "专业名称", "major"]),
          majorCode: get(record, ["专业代码", "专业代号", "majorCode"]),
          subjectReq: get(record, ["选科要求", "再选科目", "科目要求", "subjectReq"]),
          admissionType: get(record, ["招生类型", "录取类型", "admissionType"]),
          duration: get(record, ["学制", "学制(年)", "duration"]),
          tuition: get(record, ["学费", "学费(元)", "tuition"]),
          note: get(record, ["备注", "专业备注", "note"]),
          track,
          batch: get(record, ["批次", "batch"]) || "本科",
          plan: toNumber(get(record, ["计划数", "招生计划", "plan"])),
          minScore: toNumber(get(record, ["最低分", "投档最低分", "minScore"])),
          minRank: toNumber(get(record, ["最低位次", "投档最低位次", "minRank"])),
          city: get(record, ["城市", "地区", "省份", "city"]),
          source: get(record, ["来源", "source"]) || "用户导入官方表",
          dataType: "导入数据"
        };
      }).filter((row) => row.school && (row.minScore || row.minRank || row.plan));

      els.importStatus.textContent = `已导入 ${importedRows.length} 条数据。`;
      run();
    };
    reader.readAsText(file, "utf-8");
  }

  function toNumber(value) {
    const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function exportPlan() {
    if (!plan.length) {
      alert("志愿表为空。");
      return;
    }
    const header = ["序号", "院校名称", "院校专业组", "专业", "批次", "梯度", "最低分", "最低位次", "依据"];
    const body = plan.map((item, index) => [
      index + 1,
      item.school,
      item.group || "",
      item.major || "",
      item.batch || "",
      item.tier || "",
      item.minScore || "",
      item.minRank || "",
      item.source || ""
    ]);
    downloadCsv("陕西高考志愿表.csv", [header, ...body]);
  }

  function downloadTemplate() {
    downloadCsv("陕西院校专业组导入模板.csv", [[
      "年份", "批次", "首选科目", "院校代码", "院校名称", "院校专业组", "专业", "专业代码", "选科要求", "招生类型", "学制", "学费", "备注", "计划数", "最低分", "最低位次", "城市", "来源"
    ], [
      "2026", "本科", "物理", "示例代码", "示例大学", "示例专业组01", "计算机类", "01", "首选物理，再选化学", "普通类", "四年", "6000", "示例备注", "10", "600", "12000", "西安", "陕西省教育考试院/高校招生章程"
    ]]);
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadPlan() {
    try {
      return JSON.parse(localStorage.getItem("sx-gaokao-plan") || "[]");
    } catch {
      return [];
    }
  }

  function savePlan() {
    localStorage.setItem("sx-gaokao-plan", JSON.stringify(plan));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      currentTier = tab.dataset.tier;
      renderResults();
    });
  });

  els.runBtn.addEventListener("click", run);
  els.resetBtn.addEventListener("click", () => {
    ["score", "rank", "schoolKeyword", "majorKeyword", "cityKeyword"].forEach((id) => { els[id].value = ""; });
    els.advice.textContent = "输入分数后，我会按陕西官方一分段定位，并给出冲稳保分层。";
    currentResults = [];
    renderResults();
  });
  els.results.addEventListener("click", (event) => {
    const id = event.target?.dataset?.add;
    if (id) addToPlan(id);
  });
  els.planList.addEventListener("click", (event) => {
    const index = event.target?.dataset?.remove;
    if (index !== undefined) removeFromPlan(Number(index));
  });
  els.csvFile.addEventListener("change", (event) => handleImport(event.target.files[0]));
  els.exportBtn.addEventListener("click", exportPlan);
  els.clearPlanBtn.addEventListener("click", () => {
    plan = [];
    savePlan();
    renderPlan();
  });
  els.downloadTemplateBtn.addEventListener("click", downloadTemplate);

  renderSources();
  renderPlan();
  renderResults();
})();
