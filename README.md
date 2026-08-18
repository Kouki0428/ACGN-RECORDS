# ACGN Records

轻量级 ACGN（动画 / 轻小说 / 漫画 / Galgame / 单机游戏）进度追踪与统计桌面应用。
本地优先，进度可同步到 Bangumi。基于 **Electron + Vue 3 + TypeScript + Vite**。

> ⚠️ **本项目主要由 AI 辅助生成**：绝大多数代码、文档与构建配置由 AI 编码助手在开发者指导下产出，
> 未经完整人工审查。仅供学习与研究使用，不保证其正确性、安全性与稳定性，使用风险自行承担。

## 技术栈
- Electron（主进程 / 预加载 / 渲染进程三层隔离）
- Vue 3 + Vue Router + Pinia
- Vite + `vite-plugin-electron`
- better-sqlite3（本地数据库，落盘于 `userData`）
- Electron `safeStorage`（加密 Bangumi token）

## 目录结构
```
electron/   主进程：窗口、IPC、API 适配、DB、OAuth、Sync Engine
src/        渲染进程：Vue 视图、组件、Pinia store、服务封装
shared/     主/渲染进程共享的纯类型定义
build/      electron-builder 打包配置
```

## 开发
```bash
npm install          # 安装依赖（better-sqlite3 需要编译环境，见下）
npm run dev          # 启动 Vite 开发服务器并拉起 Electron
```

> Windows 上 `better-sqlite3` 需要编译环境：
> 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/)（勾选“使用 C++ 的桌面开发”）与 Python 3。
> 若安装后仍报错，执行 `npm run rebuild:sqlite` 用 electron 的 ABI 重新编译原生模块。

## 构建
```bash
npm run build        # 类型检查 + 打包渲染进程与主进程
# 打包为 Windows 安装包（需先安装 electron-builder）：
npx electron-builder --config build/electron-builder.yml
```

## 接入 Bangumi
在 https://bgm.tv/dev/app 注册应用，拿到 `client_id` / `client_secret`，
将回调地址配置为 `acgn-records://oauth/callback`，并在 `electron/services/auth/oauth.ts` 中填入。

## 进程通信模型
渲染进程只通过 `window.acgn.*`（由 `electron/preload.ts` 经 `contextBridge` 暴露）调用主进程能力；
主进程独占网络请求、数据库与密钥，保证数据隐私与进程隔离。
