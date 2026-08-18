# Bangumi Archive 离线数据库集成 — 管线验证报告

**日期：** 2026-08-09
**验证目标：** 用迷你 dump 在 Node 下跑通 `archive.service.ts` 的真实管线（download → sha256 校验 → 解压 → 入库 → 查询），确认 SQL 与常量映射正确。

## 验证方法
- 用 `adm-zip` 在内存构造含全部 9 个 JSONL 的迷你 dump（约 2KB），字段严格对齐 Bangumi Archive 真实 schema。
- 用 `esbuild` 将 `archive.service.ts` 打包为 CJS，`electron` 通过桩模块（`app.getPath`）替换、`better-sqlite3`/`adm-zip` 保持 external，在 Node 22 下加载。
- 通过 monkeypatch `globalThis.fetch`，把 `latest.json` 与 `dump.zip` 都指向本地构造数据（不依赖网络），直接驱动真实的 `updateArchive` / `searchSubjects` / `getArchiveExtra` / `getArchiveMeta`。
- 为避免破坏 Electron 构建所用的原生 `better-sqlite3`（ABI 123），验证用的 Node 22 兼容版（ABI 127）安装到独立临时目录，不触碰项目 `node_modules`。

## 验证结果

### 1. 完整管线（download → extract → ingest → query）✅
- `updateArchive` 返回 `status: "updated"`，9 张表全部入库：
  - 条目 3 行、角色 2 行、人物 2 行、章节 1 行
  - 条目-角色 2 行、条目-关联 1 行、条目-人物 1 行、人物-角色 1 行、人物-关联 1 行
- `getArchiveMeta` 正确写入：`version=dump-2026-08-09`、`sha256`、`size`、`date`、`lastSuccessAt`、`status=ok`
- `searchSubjects("测试")` 返回 3 条，**按 score 降序**（9.0 / 8.5 / 7.2）
- `searchSubjects("Test", type=2)` 类型过滤正确，返回 2 条动画

### 2. 详情页兜底数据（角色 / 关联作品 / CV）✅
`getArchiveExtra(1, 2)` 返回：
- 角色：主角A（relation=**主角**，CV=声优X，来自 `person-characters`）、配角B（relation=**配角**）
- 关联作品：测试动画前传（relation=**前传**，来自 `subject-relations` + `RELATION_LABELS[2]` 映射）

常量映射（`constants.ts` 自动生成自 bangumi/common）全部命中：主角/配角、前传、声优关联均正确翻译。

### 3. 去重逻辑（sha256 命中不重复下载）✅
同一 sha256 连续两次 `updateArchive`：第一次 `updated`（下载 1 次），第二次 `up-to-date`（下载 0 次）。
→ 设置页「立即更新」按钮在已是最新时不会重复拉取 400MB+ 全量包。

## 结论
Archive 离线数据库集成已通过端到端验证：全量入库、离线搜索、角色/关联作品/CV 离线兜底、每月自动更新调度（30 天阈值）与设置页手动更新/进度/离线搜索均已就绪。
`npm run build` 三端（vue-tsc + renderer + main + preload）此前已全绿。

## 本机使用方式
1. `taskkill /IM electron.exe /F`（若已运行）
2. `npm run dev`
3. 设置页「Bangumi 离线数据库」区块 → 点「立即更新」（约 400MB，下载后自动 sha256 校验、解压、入库、清理 zip/解压目录，仅保留 `userData/bangumi-archive/bangumi-archive.db`）
4. 之后详情页角色/关联作品/声优在实时 API 不可用或登录令牌缺失时自动回退离线库，无需登录。
