# DeepSeek Harness 插件集

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm scope: @freespace8](https://img.shields.io/badge/npm-%40freespace8-blue)](https://www.npmjs.com/search?q=%40freespace8)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（一切皆插件的 AI 开发环境）的开源插件集合。

本仓库里的每个插件都是发布在 `@freespace8` scope 下的**独立 npm 包**，可单独安装进任意 dsh profile。每个包包含 host 半体（Cordis 插件，纯 ESM）与 client 半体（浏览器 bundle），源码放在 `plugins/<name>/` 下。

[English](README.md) · **简体中文**

---

## 目录

- [插件列表](#插件列表)
- [前置条件](#前置条件)
- [安装](#安装)
- [更新与卸载](#更新与卸载)
- [从源码安装](#从源码安装)
- [开发](#开发)
  - [仓库结构](#仓库结构)
  - [添加新插件](#添加新插件)
  - [约定](#约定)
- [验证](#验证)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 插件列表

| 包 | 说明 | 安装 |
|---|---|---|
| [@freespace8/dsh-deepseek-balance](plugins/dsh-deepseek-balance/README.md) | Web GUI 会话头部显示官方 DeepSeek API 余额胶囊；非官方模型自动隐藏；点击刷新 + 定时刷新 | `dsh plugin --profile web add @freespace8/dsh-deepseek-balance` |
| [@freespace8/dsh-free-vision](plugins/dsh-free-vision/README.md) | 为无视觉能力的模型提供本地识图：OCR、表格结构识别、无文字图片语义描述（macOS Vision，完全本地），含 Web GUI 粘贴图片→本地路径 | `dsh plugin --profile web add @freespace8/dsh-free-vision` |
| [@freespace8/dsh-at-file](plugins/dsh-at-file/README.md) | Codex 风格 `@` 路径引用：输入框输入 `@` 选择工作区文件/文件夹，发送时 host 校验并注入标记（不读文件内容） | `dsh plugin --profile web add @freespace8/dsh-at-file` |

## 前置条件

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，带运行中的 `web` profile（Node.js `^22.19.0` 或 `>=24.0.0`）。
- [pnpm](https://pnpm.io/installation) —— `dsh plugin` 会转发给它（`corepack enable` 也可以）。
- `dsh-free-vision` 额外要求 **macOS 11+** 与 Xcode Command Line Tools（`xcode-select --install`）。

## 安装

`dsh plugin` 转发给 pnpm，因此可以直接从 npm registry 安装：

```sh
# 装单个插件
dsh plugin --profile web add @freespace8/dsh-deepseek-balance

# 一次装多个
dsh plugin --profile web add @freespace8/dsh-deepseek-balance @freespace8/dsh-free-vision @freespace8/dsh-at-file
```

安装后**重启目标 profile** 生效（`dsh plugin add` 只改 manifest 与依赖，运行中的实例不热加载新 bundle）。

### 更新与卸载

```sh
# 升级到最新版本
dsh plugin --profile web update @freespace8/dsh-deepseek-balance

# 卸载
dsh plugin --profile web remove @freespace8/dsh-deepseek-balance
```

`add` 默认装 latest；`update` 拉取最新发布版本。

## 从源码安装

想基于源码改动，或不想等 npm 发布，可以 clone 后用 `file:` 相对路径安装：

```sh
git clone https://github.com/freespace8/dsh-plugins.git
dsh plugin --profile web add file:./dsh-plugins/plugins/dsh-deepseek-balance
```

完整开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

### 仓库结构

```
plugins/
├── dsh-deepseek-balance/   # 官方 DeepSeek API 余额胶囊
├── dsh-free-vision/        # 本地 macOS Vision 识图
└── dsh-at-file/            # Codex 风格 @ 路径引用
```

每个插件自包含：`src/`（host）、`lib/client.js`（浏览器 bundle）、`cordis.patch.yml`（bundle patch 行）、`tests/`（产物门检查），以及各自的 `README.md` 与 `LICENSE`。

### 添加新插件

1. 复制 `plugins/dsh-deepseek-balance` 的骨架（`package.json`、`cordis.patch.yml`、`src/index.js`、`lib/client.js`、`README.md`、`tests/check.mjs`），改名为 scoped `@freespace8/<name>`；
2. host 半体放 `src/index.js`（`export const name` + `export const Config` + `apply(ctx, config)`），client 半体放 `lib/client.js`（`window.__ModuleLoader__.load({ id: <包名>, factory })`）；
3. 三个标识符必须一致：`package.json` 的 name、`cordis.patch.yml` insert 行的 `name`（scoped 名需加引号）、client bundle 的 `id`；
4. 在 `tests/check.mjs` 里写产物门检查，确保 `npm run check` 通过；
5. `npm publish` 发布（`publishConfig.access` 已设为 `public`），然后把安装命令更新到本 README 与插件 README。

### 约定

- **免构建**：host 用纯 ESM（除 `@deepseek-ai/schemastery` 外零第三方 import；确实需要时可用 `zod` / `@deepseek-ai/dsh-llm`），client 用 `React.createElement` 免打包器；不需要 tsc/tsdown。
- **client 与 host 通信（两种方式都行）**：
  - *HTTP 路由*——host 注册 `/plugins/<包名>/...` 路由，client `fetch` 它（见 `dsh-deepseek-balance`）；
  - *Typert Remote*——host 用 `ctx.typert.register` + `TypertRemoteService`，client 用 `ctx.remote.$mount`（见 `dsh-at-file`；第三方包可以扩展 typert 端点，不再受 api-remotes 白名单限制）。
- **所有可调值进 Config**：client 无配置通道，需要下发的配置（如刷新间隔）经 host 路由响应带回，或经 Remote 的 `getSettings`。
- **注册即 effect**：路由、样式、订阅都经 `ctx.effect`/`ctx.on` 归属 fiber，可随 dispose 清理。

## 验证

在插件目录下运行产物门检查：

```sh
npm run check
```

它免启动地校验语法、导出形状、`exports`/`files` 一致性、patch 行与 client bundle id。真实行为验证需把插件装进 profile 后在 GUI 里测试（见各插件 README）。

## 参与贡献

欢迎贡献！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；报告安全漏洞前请看 [SECURITY.md](SECURITY.md)。Bug 与功能请求请提交到 [issue tracker](https://github.com/freespace8/dsh-plugins/issues)。

## 许可证

MIT，见 [LICENSE](LICENSE)。衍生代码的第三方署名记录在各插件自己的 `LICENSE` 中：

- `dsh-at-file` —— 基于 [dsh-at-file](https://github.com/FSMargoo/dsh-at-file)（MIT）思路的独立实现，保留上游版权声明；
- `dsh-free-vision` —— [free-vision-skill](https://github.com/niyongsheng/free-vision-skill)（MIT）的改编，保留上游版权声明。
