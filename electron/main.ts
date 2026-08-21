// 必须最先 import：让主进程所有 fetch 自动走代理/TLS 配置（详见该模块）
import './services/api/http'
import { setManualProxy, flushNetworkNow } from './services/api/http'
import { getNetworkStats, getNetworkHistory } from './services/db/repositories/networkStats.repository'
import electron from 'electron'
const { app, BrowserWindow, ipcMain, shell, protocol, Tray, Menu, nativeImage } = electron
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, existsSync, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import { createRequire } from 'node:module'

// ── 绿色版 / 便携模式 ───────────────────────────────────────────────
// 打包后（app.isPackaged）把「用户数据目录（userData）」重定向到 exe 同级，
// 而非系统 %APPDATA%。这样整个程序文件夹可随意复制 / 放到 U 盘，数据随 exe 走。
// 主库 (acgn-records.db)、离线库 (bangumi-archive/) 都基于 userData，会一并跟随。
// 开发模式下保持默认 AppData，避免污染项目目录。
// 如需在开发时验证便携路径，可临时设环境变量 ACGN_PORTABLE=1（会把数据写到
// electron 二进制所在目录，仅用于自测，勿用于日常开发）。
const PORTABLE = app.isPackaged || process.env.ACGN_PORTABLE === '1'
if (PORTABLE) {
  // 先拿到「默认位置」（系统 %APPDATA%/acgn-records），作为迁移来源
  const oldUserData = app.getPath('userData')
  const exeDir = dirname(app.getPath('exe'))
  const newUserData = join(exeDir, 'userData')
  app.setPath('userData', newUserData)
  migrateUserDataIfNeeded(oldUserData, newUserData)
}

// ── 首次启动迁移：把系统盘的旧数据搬进绿色版 userData ──────────────────
// 仅当「目标便携目录的主库不存在，或虽有主库但尚无任何收藏记录」时才从旧位置复制，
// 避免覆盖用户已经在便携目录里产生的新数据
// （例如把整个绿色文件夹复制到新机器、而新机器旧 AppData 也恰有数据时，不动便携数据）。
// 复制范围覆盖：个人数据 + 缓存（同在 acgn-records.db）、离线库（bangumi-archive/）。
function migrateUserDataIfNeeded(oldDir: string, newDir: string) {
  if (!existsSync(oldDir)) return
  const newDb = join(newDir, 'acgn-records.db')
  if (existsSync(newDb) && dbHasUserData(newDb)) return
  try {
    mkdirSync(newDir, { recursive: true })
    // 1) 主库 + 缓存 + 调试日志（含 WAL/SHM 附属文件）
    for (const f of ['acgn-records.db', 'acgn-records.db-wal', 'acgn-records.db-shm', 'debug.log']) {
      const src = join(oldDir, f)
      if (existsSync(src)) copyFileSync(src, join(newDir, f))
    }
    // 2) 离线库（整个 bangumi-archive 目录）
    const oldArc = join(oldDir, 'bangumi-archive')
    if (existsSync(oldArc)) cpSync(oldArc, join(newDir, 'bangumi-archive'), { recursive: true })
    console.log(`[portable] migrated user data: ${oldDir} -> ${newDir}`)
  } catch (e) {
    console.error('[portable] migration failed', e)
  }
}

// 判断库里是否已存在用户收藏（用于决定是否需要迁移，避免覆盖真实数据）
function dbHasUserData(dbPath: string): boolean {
  try {
    const require = createRequire(import.meta.url)
    const Database = require('better-sqlite3') as { new (p: string, o?: object): any }
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare('SELECT COUNT(*) AS c FROM collections').get() as { c: number }
    db.close()
    return row.c > 0
  } catch {
    return false
  }
}

// GPU 加速开关（设置项 gpuAcceleration；默认关闭，与历史行为一致）。
// 关闭硬件加速：修复 Windows 上拖动缩放窗口时「上一帧画面残留在新画面之后」的 GPU 合成重影
// （三图层：实时主场景 / 旧帧重影 / 窗口黑底）。软件渲染每个 resize 事件都会整窗同步重绘，
// 不再保留上一帧的独立合成层，重影彻底消失。
// 代价：CSS 动画改为 CPU 合成（卡片 FLIP / 主题擦除仍可正常播放，仅更费 CPU，体感无差）；
// 搜索遮罩的 `backdrop-filter` 毛玻璃可能退化为半透明纯色（仍可用，只是不再模糊）。
// 仅在设置里显式开启 GPU 加速（gpuAcceleration = '1'）时才保留硬件加速。
// 注意：disableHardwareAcceleration 必须在 app.ready 之前调用，故用同步只读方式读该设置键
// （不能用异步 getDb()，否则可能晚于 ready）。文件不存在时按“关闭”处理（安全默认）。
function isGpuAccelerationEnabled(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const Database = require('better-sqlite3') as { new (p: string, o?: object): any }
    const dbPath = join(app.getPath('userData'), 'acgn-records.db')
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('gpuAcceleration') as { value: string } | undefined
    db.close()
    return row?.value === '1'
  } catch {
    return false
  }
}

if (!isGpuAccelerationEnabled()) {
  app.disableHardwareAcceleration()
}

import { registerImageProxySchemes, registerImageProxy } from './services/api/imageProxy'

// 在 app ready 前声明 acgn-img 特权 scheme（图片代理，使渲染端 <img> 走主进程代理拉图）
registerImageProxySchemes()

// 本项目 package.json 为 "type":"module"，主进程被按 ESM 加载，ESM 中没有 Node 的
// __dirname / __filename。这里从 import.meta.url 手动推导，保证 BrowserWindow 的
// preload 与 loadFile 路径解析正常（否则会抛 "ReferenceError: __dirname is not defined"）。
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// dev 模式下把本进程 PID 写入文件，供下次 `npm run dev` 的 kill-stale 脚本精准清理
// 残留 electron（Ctrl+C 关闭 npm 时 electron 子进程常残留，导致用户一直看到旧窗口）。
if (!app.isPackaged) {
  try {
    writeFileSync(join(__dirname, '..', '.electron-dev.pid'), String(process.pid))
  } catch {
    /* 忽略写入失败 */
  }
}
import { registerDbIpc } from './ipc/db.ipc'
import { registerApiIpc } from './ipc/api.ipc'
import { registerAuthIpc } from './ipc/auth.ipc'
import { registerSyncIpc } from './ipc/sync.ipc'
import { registerBackupIpc } from './ipc/backup.ipc'
import { registerAnimeIpc } from './ipc/anime.ipc'
import { registerSubjectIpc } from './ipc/subject.ipc'
import { registerEpisodeIpc } from './ipc/episode.ipc'
import { registerCollectionIpc } from './ipc/collection.ipc'
import { registerPurchasesIpc } from './ipc/purchases.ipc'
import { registerArchiveIpc } from './ipc/archive.ipc'
import { registerCacheIpc, maybeAutoCleanCache } from './ipc/cache.ipc'
import { maybeAutoUpdateArchive, warmArchiveDb } from './services/archive/archive.service'
import { buildMenu } from './menu'
import { getSetting, setSetting } from './services/db/repositories/settings.repository'
import { pushAll, pullAll, onSyncState } from './services/sync/syncEngine'
import { reclassifyBooks } from './services/db/repositories/subjects.repository'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    // 自动隐藏原生菜单栏：顶部的「ACGN Records / 编辑」菜单条默认不显示（按 Alt 临时浮现），
    // 但菜单仍保留 → Ctrl+R 重载 / Ctrl+Shift+I 开 DevTools / Ctrl+C·V·X 编辑快捷键均有效。
    autoHideMenuBar: true,
    title: 'ACGN Records',
    // 与暗色主题渐变底色（--bg 的 #14171c，即 --bg-grad 的 60% 停靠色，覆盖窗口绝大部分区域）一致，
    // 这样缩放窗口时 Chromium 重绘滞后一帧、露出的“窗口底色”与内容背景同色，肉眼不可见，消除“后面还有一层”的黑边/色差。
    backgroundColor: '#14171c',
    webPreferences: {
      // 安全：隔离上下文 + 禁用 nodeIntegration，仅经 preload 暴露白名单 API
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // vite-plugin-electron 在开发时注入该环境变量指向 Vite dev server
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    win = null
  })

  // 关闭行为：closeBehavior='minimize' 时点 X 缩到托盘（不退出，后台同步继续）；
  // 'exit' 或应用正在退出时放行默认关闭。
  win.on('close', (e) => {
    if (!isQuitting && closeBehavior === 'minimize') {
      e.preventDefault()
      win?.hide()
    }
  })

  // 禁用鼠标侧键（后退 X1 / 前进 X2）触发的浏览器原生前进后退，
  // 改由渲染进程统一处理（详情↔列表 + 标签页路由），避免双重跳转。
  // 命令串在不同 Electron 版本可能是 browser-backward / browser-back / browser-forward，
  // 用 startsWith 宽泛匹配，确保原生导航一定被拦住。
  win.webContents.on('app-command', (e, cmd) => {
    if (typeof cmd === 'string' && (cmd.startsWith('browser-back') || cmd.startsWith('browser-forward'))) {
      e.preventDefault()
    }
  })
}

// ---- 应用级 IPC（与设计的 db/api/auth/sync 并列）----
ipcMain.handle('app:getInfo', () => ({
  name: app.getName(),
  version: app.getVersion()
}))

ipcMain.handle('app:openExternal', (_event, url: string) => {
  shell.openExternal(url)
})

// 重启应用（用于需要重启才生效的启动期设置，如 GPU 加速开关）。
// dev 模式下会继承当前进程 env（含 VITE_DEV_SERVER_URL），仍会重新连上 Vite dev server。
ipcMain.handle('app:relaunch', () => {
  app.relaunch()
  app.exit(0)
})

// 运行时设置 / 清除手动代理（设置项 `proxy`）。传 null/空串即清除。免重启生效。
ipcMain.handle('app:setProxy', (_event, url: unknown) => {
  setManualProxy(typeof url === 'string' && url.trim() ? url.trim() : null)
})

// 拉取应用网络使用量统计（当月 + 近 6 月历史），供设置页「网络使用量」卡片展示。
ipcMain.handle('app:getNetworkStats', async () => {
  const [current, history] = await Promise.all([getNetworkStats(), getNetworkHistory(6)])
  return { current, history }
})

// 退出前强制落库：把 debounce 攒批的网络统计增量写入 network_stats，避免数据丢失。
// ===== 托盘常驻 + 关闭行为 =====
// closeBehavior：'minimize'（默认，点 X 缩到托盘）/ 'exit'（点 X 直接退出）。
// 启动期同步读一次 settings 表（同 gpuAcceleration 模式）；渲染端改动经 app:setCloseBehavior 更新缓存。
let tray: import('electron').Tray | null = null
let closeBehavior: 'minimize' | 'exit' = 'minimize'
function showMainWindow() {
  if (!win) createWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}
function createTray() {
  try {
    // 内嵌生成的 32×32 品牌粉圆角方块 PNG（仓库无图标资源）
    const TRAY_PNG =
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAWklEQVR4nO3XOw4AIAgEUQ7qibw01mqMxA9QjImt80pXxHC0VD29lvefBq9BP+NbhEd8ifCMT4iIeIcAEAqIjAMAAAAAAAAANMV/AEAKQPguSLGMUmxDD8TYar3jvZMwbVaxAAAAAElFTkSuQmCC'
    const img = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_PNG}`)
    tray = new Tray(img)
    tray.setToolTip('ACGN Records')
    const menu = Menu.buildFromTemplate([
      { label: '显示主界面', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => showMainWindow())
  } catch (e) {
    console.warn('[tray] 创建失败（忽略，功能降级）：', e)
    tray = null
  }
}
let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  void flushNetworkNow().finally(() => app.exit(0))
})

// 主题切换过渡：截取当前窗口完整画面（旧主题真实外观），返回 PNG dataURL。
// 必须在渲染进程改 data-theme 之前调用，才能截到“旧画面”用于擦除式过渡。
ipcMain.handle('theme:capture', async () => {
  if (!win) return null
  const img = await win.webContents.capturePage()
  return img.toDataURL()
})

// 主题切换时同步原生窗口背景色，使缩放窗口露出的“窗口底色”与内容背景一致（消除黑边/色差层）。
ipcMain.handle('theme:setNativeBg', (_event, color: string) => {
  if (win) win.setBackgroundColor(color)
})

app.whenReady().then(() => {
  registerDbIpc()
  registerApiIpc()
  registerAuthIpc()
  registerSyncIpc()
  registerAnimeIpc()
  registerSubjectIpc()
  registerEpisodeIpc()
  registerCollectionIpc()
  registerPurchasesIpc()
  registerArchiveIpc()
  registerCacheIpc()
  registerBackupIpc()
  // 图片代理协议：渲染端 acgn-img:// 由主进程（走代理）下载 Bangumi 图片 CDN
  registerImageProxy()

  createWindow()
  buildMenu()
  setupAutoSync()
  // 托盘常驻 + 关闭行为（启动期同步读 settings，运行期经 app:setCloseBehavior 更新）
  closeBehavior = readCloseBehaviorSync()
  createTray()
  ipcMain.handle('app:setCloseBehavior', (_e, v: unknown) => {
    if (v === 'exit' || v === 'minimize') closeBehavior = v
  })
  // 同步引擎状态 → 渲染进程（侧栏同步指示灯订阅 sync:stateChanged）
  onSyncState((s) => {
    const w = BrowserWindow.getAllWindows()[0]
    w?.webContents.send('sync:stateChanged', s)
  })
  // 每月自动更新 Bangumi 离线数据库（若距上次成功超过 30 天）
  maybeAutoUpdateArchive().catch(() => {})
  // 每月自动清理过期缓存（删除半年前未刷新的辅助缓存，若距上次清理超过 30 天）
  maybeAutoCleanCache().catch(() => {})
  // 预热离线库连接：把 400MB Archive 库的冷打开成本前置到启动阶段，
  // 避免首次打开作品详情时因懒加载打开该库而卡顿 0.5~1s（文件不存在时静默跳过）
  warmArchiveDb()
  setInterval(() => {
    maybeAutoUpdateArchive().catch(() => {})
    maybeAutoCleanCache().catch(() => {})
  }, 24 * 3600 * 1000)
  // 一次性：重新判定本地书籍分类（轻小说/漫画），修正存量数据。
  // 规则：platform 字段优先（实测 100% 准确），缺失时按 tag 计数细分
  // （覆盖此前纯 book_category 把大量书籍误归为 manga 的问题）。后台静默执行（不阻塞启动），
  // 用 settings 标记保证只跑一次（V3=platform 优先新规则）；逐本拉 Bangumi 详情，网络/限流失败自动跳过。
  void (async () => {
    try {
      const done = await getSetting('booksReclassifiedV4')
      if (!done) {
        const summary = await reclassifyBooks()
        // 若全部失败（多半是离线/未联网），不写标记，下次启动重试；否则标记已完成
        if (!(summary.total > 0 && summary.failed === summary.total)) {
          await setSetting('booksReclassifiedV4', String(Date.now()))
        }
      }
    } catch (e) {
      console.warn('[reclassify] 启动重分类跳过：', e)
    }
  })()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** 若用户开启自动同步，则每天把本地脏收藏上传到 Bangumi */
function setupAutoSync(): void {
  getSetting('autoSync')
    .then((v) => {
      if (v === '1') {
        setInterval(() => {
          pushAll().catch(() => {
            /* 静默失败，下次周期重试 */
          })
        }, 24 * 3600 * 1000)
      }
    })
    .catch(() => {
      /* 设置未就绪，忽略 */
    })

  // 每月自动从 Bangumi 全量拉取（含取消收藏差集删除），与每日自动上传互补
  getSetting('autoFullPull')
    .then((v) => {
      if (v === '1') {
        const MONTH = 30 * 24 * 60 * 60 * 1000
        setInterval(() => {
          pullAll({ full: true }).catch(() => {
            /* 静默失败，下次周期重试 */
          })
        }, MONTH)
      }
    })
    .catch(() => {
      /* 设置未就绪，忽略 */
    })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
