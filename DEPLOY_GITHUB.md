# 部署到 GitHub Pages

推荐仓库名：`shanxi-gaokao-helper`

部署后网址通常是：

```text
https://cc583.github.io/shanxi-gaokao-helper/
```

## 需要你先做一次

1. 打开 GitHub，新建一个空仓库：`shanxi-gaokao-helper`
2. 不要勾选自动创建 README、.gitignore 或 license。
3. 把这个仓库授权给当前 Codex/GitHub 连接，或在本机安装并登录 GitHub CLI。

## 仓库设置

推送完成后，在 GitHub 仓库里进入：

```text
Settings -> Pages -> Build and deployment
```

设置：

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

保存后等待一两分钟，GitHub 会生成公网网址。

## 文件说明

网站入口是 `index.html`，数据文件在 `data/official-data.js`。这是纯静态网页，不需要服务器程序。
