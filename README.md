<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Repo2Script — 打开 GitHub 仓库页，粘贴一段脚本，生成 setup.sh；无需 Token、无需 clone">
</p>

<p align="center">
  <a href="https://holynova.github.io/one-punch/">▶ 在线体验 Live Demo</a>
  ·
  <a href="https://github.com/holynova/one-punch">GitHub 仓库</a>
</p>

Repo2Script 是一个只在浏览器里运行的 GitHub 仓库导出工具：打开任意能看见的仓库页面，把 `dist/repo2script.paste.js` 粘贴到 DevTools Console，它会遍历当前仓库树、读取文本文件，生成一份可恢复整个项目的 `setup.sh`。不调用 GitHub API，不需要 Token，不用 `git clone`，不经过任何第三方服务。

Repo2Script is a browser-only GitHub repository exporter. Open any repository page you can see, paste `dist/repo2script.paste.js` into the DevTools Console, and it walks the current tree, reads the text files, and builds a `setup.sh` that restores the whole project. No GitHub API, no token, no `git clone`, no third-party service.

## 截图 / Screenshots

<p align="center">
  <img src="./assets/readme/screenshot.png" width="800" alt="Repo2Script 落地页：Turn a visible GitHub repository into a local setup.sh，右侧终端面板展示三步流程">
</p>

## 用法 / How to Use

1. **打开**：在浏览器打开目标仓库的根目录页面（能看见文件树即可）。
2. **粘贴**：打开 DevTools Console，粘贴 `dist/repo2script.paste.js` 的内容并运行。
3. **恢复**：复制生成的 `setup.sh`，在本地文件夹运行，目录与文件即按原样写出。

生成的脚本只创建目录和写入文件，不执行项目代码。

## 能力与限制 / Capabilities & Limits

- **只处理 UTF-8 文本文件**；二进制文件、软链接、子模块和超出限制的内容会在结果面板与生成的脚本注释中逐项报告，不会静默丢掉。
- **上限**（代码默认值）：最多 500 个文件、单个文本文件 2 MiB、文本总量 10 MiB。
- **Phase 1**：当前版本为 v0.1.0，功能边界如上，详见站内 "Small surface. Clear limits." 一节。

## 本地开发 / Development

```bash
npm install
npm test        # Node 内置测试运行器（linkedom 模拟 GitHub 页面）
npm run typecheck
npm run build   # esbuild 打包出 dist/repo2script.paste.js
```

## 技术 / Tech

- TypeScript + esbuild；测试用 Node 内置 `node:test`，以 linkedom + 本地 HTML fixture 模拟 GitHub 树页与 blob 页。
- 导出脚本读取的是浏览器当前可见的 GitHub HTML 页面（树页、blob 页），而非 API 返回。

```
src/crawler/crawl.ts    遍历仓库树、读取文件、上限控制
src/github/adapter.ts   GitHub 页面解析适配（树页 / blob 页）
src/github/identify.ts  仓库 URL 识别与校验
src/generator/bash.ts   生成 setup.sh（含 base64 编码与分隔符）
src/ui/overlay.ts       浏览器内结果面板
dist/repo2script.paste.js   打包好的粘贴脚本（构建产物）
test/                   核心测试 + GitHub 页面 fixture
```

## English

**Repo2Script** turns a visible GitHub repository into a local `setup.sh` — entirely in the browser.

- **Use it**: open a repository root page → open the DevTools Console → paste `dist/repo2script.paste.js` → copy the generated `setup.sh` and run it in a local folder.
- **No API, no token, no clone, no third-party service** — it reads the GitHub HTML pages your browser can already see.
- **Limits** (defaults in code): max 500 files, 2 MiB per text file, 10 MiB total text. UTF-8 text files only; binaries, symlinks, submodules, and over-limit content are reported in the result overlay and in script comments — never silently dropped.
- **Safe by design**: the generated script only creates directories and writes files; it never executes project code.
- **Develop**: `npm install && npm test && npm run typecheck && npm run build` (esbuild bundles `dist/repo2script.paste.js`).
- **Tech**: TypeScript + esbuild; tests use Node's built-in `node:test` with linkedom and local HTML fixtures simulating GitHub tree/blob pages. Current version: v0.1.0 (Phase 1).

## 许可 / License

本仓库暂未添加 LICENSE 文件。
