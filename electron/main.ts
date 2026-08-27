// 必须最先 import：让主进程所有 fetch 自动走代理/TLS 配置（详见该模块）
import './services/api/http'
import { setManualProxy, flushNetworkNow } from './services/api/http'
import { getNetworkStats, getNetworkHistory, getTodayStats } from './services/db/repositories/networkStats.repository'
import { closeDb } from './services/db/connection'
import electron from 'electron'
const { app, BrowserWindow, ipcMain, shell, protocol, Tray, Menu, nativeImage, dialog } = electron
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'

// ── 数据目录解析（安装版默认 exe 同级 userData，可自定义）──────────────────
// 解析优先级（必须在打开任何数据库之前执行；全应用统一经 app.getPath('userData') 取值）：
// ① 环境变量 ACGN_DATA_DIR = 自定义数据目录绝对路径
// ② exe 同级 data-dir.txt：内容为目录路径；留空 = 明确使用 exe 同级 userData
// ③ 默认：exe 同级的 userData 文件夹（数据与安装位置一致）
// ④ 目标不可写（如被装进 Program Files）→ 自动回退 %APPDATA% 下的 bangumi-for-pc 并告警
// 开发模式（未打包且未设 ①）保持系统默认 AppData，避免污染 node_modules。
const EXE_ADJACENT = app.isPackaged || process.env.ACGN_PORTABLE === '1'

function resolveDataDirSync(): string {
  const envDir = process.env.ACGN_DATA_DIR?.trim()
  if (envDir) {
    try { mkdirSync(envDir, { recursive: true }) } catch {}
    return envDir
  }
  // ② 设置页写入的持久化覆盖（固定放在 %APPDATA% 根，永远可写）
    const confPath = join(app.getPath('appData'), 'bangumi-for-pc', 'data-location.conf')
  if (existsSync(confPath)) {
    const custom = readFileSync(confPath, 'utf8').trim()
    if (custom) {
      try { mkdirSync(custom, { recursive: true }) } catch {}
      return custom
    }
  }
  if (!EXE_ADJACENT) return join(app.getPath('appData'), 'bangumi-for-pc')
  const exeDir = dirname(app.getPath('exe'))
  try {
    const confPath2 = join(exeDir, 'data-dir.txt')
    if (existsSync(confPath2)) {
      const custom = readFileSync(confPath2, 'utf8').trim()
      if (custom) {
        mkdirSync(custom, { recursive: true })
        return custom
      }
      // 留空 = 明确使用 exe 同级 userData
    }
  } catch { /* 读失败按默认处理 */ }
  const def = join(exeDir, 'userData')
  try {
    mkdirSync(def, { recursive: true })
    const probe = join(def, `.write-test-${Date.now()}`)
    writeFileSync(probe, '1')
    rmSync(probe)
    return def
  } catch {
    console.warn('[data-dir] 安装目录不可写，回退 %APPDATA% 下的 bangumi-for-pc')
    return join(app.getPath('appData'), 'bangumi-for-pc')
  }
}

/** 写入/清除「数据目录」覆盖配置（null = 恢复默认解析链）。 */
function writeDataDirConf(dir: string | null) {
  const confDir = join(app.getPath('appData'), 'bangumi-for-pc')
  mkdirSync(confDir, { recursive: true })
  const confPath = join(confDir, 'data-location.conf')
  if (dir) writeFileSync(confPath, dir, 'utf8')
  else if (existsSync(confPath)) rmSync(confPath)
}

const LEGACY_APP_DATA_DIR = join(app.getPath('appData'), 'acgn-records')
const DATA_DIR = resolveDataDirSync()
app.setPath('userData', DATA_DIR)
migrateUserDataIfNeeded(LEGACY_APP_DATA_DIR, DATA_DIR)

// ── 首次启动迁移：把系统盘的旧数据搬进绿色版 userData ──────────────────
// 仅当「目标便携目录的主库不存在，或虽有主库但尚无任何收藏记录」时才从旧位置复制，
// 避免覆盖用户已经在便携目录里产生的新数据
// （例如把整个绿色文件夹复制到新机器、而新机器旧 AppData 也恰有数据时，不动便携数据）。
// 复制范围覆盖：个人数据 + 缓存（同在 bangumi-for-pc.db）、离线库（bangumi-archive/）。
function migrateUserDataIfNeeded(oldDir: string, newDir: string) {
  if (!existsSync(oldDir) || oldDir === newDir) return
  const newDb = join(newDir, 'bangumi-for-pc.db')
  if (existsSync(newDb) && dbHasUserData(newDb)) return
  try {
    mkdirSync(newDir, { recursive: true })
    // 1) 主库 + 缓存 + 调试日志（含 WAL/SHM 附属文件），并重命名为新文件名
    const dbMap: [string, string][] = [
      ['acgn-records.db', 'bangumi-for-pc.db'],
      ['acgn-records.db-wal', 'bangumi-for-pc.db-wal'],
      ['acgn-records.db-shm', 'bangumi-for-pc.db-shm'],
    ]
    for (const [srcName, dstName] of dbMap) {
      const src = join(oldDir, srcName)
      if (existsSync(src)) copyFileSync(src, join(newDir, dstName))
    }
    for (const f of ['debug.log', 'data-location.conf']) {
      const src = join(oldDir, f)
      if (existsSync(src)) copyFileSync(src, join(newDir, f))
    }
    // 2) 离线库与备份（整个目录）
    for (const sub of ['bangumi-archive', 'backups']) {
      const oldSub = join(oldDir, sub)
      if (existsSync(oldSub)) cpSync(oldSub, join(newDir, sub), { recursive: true })
    }
    // 3) 复制成功 → 删除旧目录（用户已确认可删；删除失败仅告警，不阻断新数据）
    if (existsSync(newDb)) {
      try { rmSync(oldDir, { recursive: true, force: true }) } catch (e) { console.warn('[migrate] 旧目录删除失败（可手动删）', e) }
    }
    console.log(`[migrate] user data: ${oldDir} -> ${newDir}`)
  } catch (e) {
    console.error('[migrate] failed', e)
  }
}

// 判断库里是否已存在用户收藏（用于决定是否需要迁移，避免覆盖真实数据）
function dbHasUserData(dbPath: string): boolean {  try {
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
    const dbPath = join(app.getPath('userData'), 'bangumi-for-pc.db')
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
import { deleteExpiredCache } from './services/db/repositories/cache.repository'
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
    // 自动隐藏原生菜单栏：顶部的「Bangumi / 编辑」菜单条默认不显示（按 Alt 临时浮现），
    // 但菜单仍保留 → Ctrl+R 重载 / Ctrl+Shift+I 开 DevTools / Ctrl+C·V·X 编辑快捷键均有效。
    autoHideMenuBar: true,
    // 完全去原生边框（frame: false）：内容铺满整窗、右侧无原生边框缝。
    // 标题栏拖拽走 -webkit-app-region: drag；窗口四周缩放改由渲染层 ResizeHandles 用
    // win.setBounds 驱动（见 App.vue / ResizeHandles.vue）——尺寸变化由 Chromium 自身发起，
    // 合成层随内容同步重绘，根除「frameless 原生缩放时合成层滞后」导致的重影；动画全程不被碰。
    frame: false,
    title: 'Bangumi',
    // 运行时窗口图标用 PNG（Electron 加载最可靠）；.ico 仅用于 exe 内嵌资源
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '..', 'build', 'icon.png'),
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

  // 关闭行为：minimize → 缩到托盘；exit → 直接退出。
  // exit 且用户从未选择过（首次关闭）→ 弹窗询问「缩到托盘 / 直接退出」，
  // 可勾选记住；此后按记忆行为静默执行。
  win.on('close', (e) => {
    if (isQuitting) return
    if (closeBehavior === 'minimize') {
      e.preventDefault()
      win?.hide()
      return
    }
    // exit 模式：未做过选择时通过渲染层弹出自定义选择窗（非系统原生对话框）
    void (async () => {
      const chosen = await getSetting('closeBehaviorChosen')
      if (chosen === '1') {
        app.quit()
        return
      }
      e.preventDefault()
      // 通过渲染层展示自定义选择窗，等待用户回复
      const pick = await new Promise<'minimize' | 'exit'>(resolve => {
        closeBehaviorResolver = resolve
        win?.webContents.send('closeBehavior:ask')
        // 超时兜底：15s 无回复按「缩到托盘」处理（安全默认）
        setTimeout(() => {
          if (closeBehaviorResolver) {
            const r = closeBehaviorResolver
            closeBehaviorResolver = null
            r('minimize')
          }
        }, 15000)
      })
      if (pick === 'minimize') {
        win?.hide()
        return
      }
      isQuitting = true
      try {
        tray?.destroy()
      } catch {
        /* ignore */
      }
      app.quit()
    })()
    e.preventDefault() // 拦下同步默认行为，等待上面的异步决策
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

  // 自定义标题栏：最大化/还原时通知渲染层，用于切换按钮图标
  win.on('maximize', () => win?.webContents.send('window:maximized-change', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized-change', false))

  // 自定义窗口缩放：frame:false 下仍用 WM_NCHITTEST 钩子让 OS 在光标线程原生执行
  // resize（4px 抓取区，零延迟、自动遵守 min/max 尺寸）。标题栏拖拽仍由渲染层 -webkit-app-region 处理；
  // 右上按钮区返回 HTCLIENT，保证最小化/最大化/关闭按钮可点击。仅 Windows。
  if (process.platform === 'win32') {
    const WM_NCHITTEST = 0x0084
    const HTCLIENT = 0x0001
    const HTLEFT = 0x000a
    const HTRIGHT = 0x000b
    const HTTOP = 0x000c
    const HTTOPLEFT = 0x000d
    const HTTOPRIGHT = 0x000e
    const HTBOTTOM = 0x000f
    const HTBOTTOMLEFT = 0x0010
    const HTBOTTOMRIGHT = 0x0011
    const EDGE = 4 // 抓取边宽
    const TITLE_H = 32 // 标题栏高度
    const BTN_W = 120 // 右上三按钮区宽度（3×40px）
    win?.hookWindowMessage(WM_NCHITTEST, (_w, l) => {
      const x = l.readInt16LE(0)
      const y = l.readInt16LE(2)
      const b = win?.getBounds()
      if (!b) return HTCLIENT
      const px = x - b.x
      const py = y - b.y
      const w = b.width
      const h = b.height
      // 右上按钮区：交给渲染层，保证按钮可点（优先于边缘命中）
      if (py <= TITLE_H && px >= w - BTN_W) return HTCLIENT
      const left = px <= EDGE
      const right = px >= w - EDGE
      const top = py <= EDGE
      const bottom = py >= h - EDGE
      if (top && left) return HTTOPLEFT
      if (top && right) return HTTOPRIGHT
      if (bottom && left) return HTBOTTOMLEFT
      if (bottom && right) return HTBOTTOMRIGHT
      if (left) return HTLEFT
      if (right) return HTRIGHT
      if (top) return HTTOP
      if (bottom) return HTBOTTOM
      return HTCLIENT
    })
  }
}

// ---- 自定义窗口控制（替代原生标题栏；渲染层 TitleBar / ResizeHandles 调用）----
ipcMain.handle('window:minimize', () => {
  win?.minimize()
})
ipcMain.handle('window:toggle-maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window:close', () => {
  // 走原生 close 流程：受「关闭行为」逻辑约束（缩到托盘 / 直接退出）
  win?.close()
})
ipcMain.handle('window:is-maximized', () => !!win?.isMaximized())
ipcMain.handle('window:get-bounds', () => win?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 })
ipcMain.handle('window:set-bounds', (_e, bounds: { x: number; y: number; width: number; height: number }) => {
  win?.setBounds(bounds)
})

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

// 拉取应用网络使用量统计（当天 + 当月 + 近 6 月历史），供设置页「网络使用量」卡片展示。
ipcMain.handle('app:getNetworkStats', async () => {
  const [current, history, today] = await Promise.all([
    getNetworkStats(),
    getNetworkHistory(6),
    getTodayStats()
  ])
  return { current, history, today }
})

// 退出前强制落库：把 debounce 攒批的网络统计增量写入 network_stats，避免数据丢失。
// ===== 托盘常驻 + 关闭行为 =====
// closeBehavior：'minimize'（默认，点 X 缩到托盘）/ 'exit'（点 X 直接退出）。
// 启动期同步读一次 settings 表（同 gpuAcceleration 模式）；渲染端改动经 app:setCloseBehavior 更新缓存。
// ── 数据目录解析结果 ──
interface DataSetDirResult {
  ok: boolean
  canceled?: boolean
  sameTarget?: boolean
  path?: string
  error?: string
}

let tray: import('electron').Tray | null = null
// 默认 'exit'（托盘功能默认关闭）；用户首次关闭时弹窗选择后记忆
let closeBehavior: 'minimize' | 'exit' = 'exit'
// 渲染层关闭行为选择窗的回复回调（首次关闭时由 close handler 设置）
let closeBehaviorResolver: ((pick: 'minimize' | 'exit') => void) | null = null
function readCloseBehaviorSync(): 'minimize' | 'exit' {
  try {
    const require = createRequire(import.meta.url)
    const Database = require('better-sqlite3') as { new (p: string, o?: object): any }
    const dbPath = join(app.getPath('userData'), 'bangumi-for-pc.db')
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('closeBehavior') as
      | { value: string }
      | undefined
    db.close()
    // 未设置过 = 默认直接退出（托盘功能默认关闭；首次关闭时会弹窗询问一次）
    return row?.value === 'minimize' ? 'minimize' : 'exit'
  } catch {
    return 'exit'
  }
}
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
    // 托盘专用图标：16px(100% DPI) + 32px(200% DPI) 双分辨率表示。
    // 若直接用 256px 大图，Windows 缩到 16px 会把小电视细节完全糊掉。
    const base = app.isPackaged ? process.resourcesPath : join(__dirname, '..', 'build')
    const img = nativeImage.createEmpty()
    for (const [sf, file] of [[1, 'icon-16.png'], [2, 'icon-32.png']] as const) {
      const p = join(base, file)
      if (existsSync(p)) img.addRepresentation({ scaleFactor: sf, buffer: readFileSync(p) })
    }
    const finalImg = img.isEmpty() ? nativeImage.createFromPath(join(base, 'icon.png')) : img
    tray = new Tray(finalImg)
    tray.setToolTip('Bangumi')
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
// 自动更新器触发 quitAndInstall 时置位：before-quit 直接放行（不 preventDefault），
// 否则 flushNetworkNow().finally(app.exit(0)) 会让安装程序永远等不到退出。
let installingUpdate = false
app.on('before-quit', (event) => {
  if (isQuitting || installingUpdate) return
  event.preventDefault()
  isQuitting = true
  void flushNetworkNow().finally(() => app.exit(0))
})

// ── 应用内自动更新（electron-updater + GitHub Releases）────────────────
// 仅打包版启用；NSIS 静默升级需要安装目录可写（默认 per-user 路径可写 ✓）。
import { autoUpdater } from 'electron-updater'
function setupAutoUpdater() {
  if (!app.isPackaged) return
  try {
    autoUpdater.autoDownload = true
    autoUpdater.on('update-downloaded', async () => {
      try {
        const r = await dialog.showMessageBox({
          type: 'info',
          title: '更新就绪',
          message: '新版本已下载完成，是否立即重启安装？',
          buttons: ['立即重启安装', '稍后'],
          defaultId: 0,
          cancelId: 1
        })
        if (r.response === 0) {
          installingUpdate = true
          isQuitting = true
          autoUpdater.quitAndInstall()
        }
      } catch (err) {
        console.warn('[updater] 更新对话框失败：', err)
      }
    })
    autoUpdater.on('error', (e) => console.warn('[updater] 检查/下载更新失败：', e))
    // 启动 15s 后首查，此后每 24h 一次
    setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 15000)
    setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 24 * 3600 * 1000)
  } catch (e) {
    console.warn('[updater] 初始化失败：', e)
  }
}

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const r = await autoUpdater.checkForUpdates()
      const v = (r as any)?.updateInfo?.version
      return { ok: true, updateAvailable: !!v && v !== app.getVersion(), version: v }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 渲染层回复「首次关闭行为选择」；仅勾选「记住」时才持久化 closeBehaviorChosen
  ipcMain.on('app:answerCloseBehavior', (_e, pick: 'minimize' | 'exit', remember: boolean) => {
    if (closeBehaviorResolver) {
      const r = closeBehaviorResolver
      closeBehaviorResolver = null
      if (pick === 'minimize' || pick === 'exit') {
        void setSetting('closeBehavior', pick).catch(() => {})
        // 只有勾选「记住选择」时才写 chosen 标记，否则下次关闭仍会弹出询问
        if (remember) void setSetting('closeBehaviorChosen', '1').catch(() => {})
        closeBehavior = pick
      }
      r(pick)
    }
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

// ── 首次启动导入引导（仅安装版）─────────────────────────────────────
// 目标 userData 尚无主库且从未询问过时，提示从旧版便携包文件夹导入
// （复制主库族 / debug 日志 / bangumi-archive 离线库 / backups）。
// 只询问一次：写入 .import-asked 标记，之后可随时用「备份导入」手动补。
async function maybePromptLegacyImport() {
  try {
    if (!app.isPackaged) return
    const dir = app.getPath('userData')
    if (existsSync(join(dir, 'bangumi-for-pc.db'))) return
    const marker = join(dir, '.import-asked')
    if (existsSync(marker)) return
    writeFileSync(marker, '1') // 只询问一次（无论用户选什么）
    const r = await dialog.showMessageBox({
      type: 'question',
      title: '导入旧版数据',
      message: '检测到全新安装。要把旧版便携包里的数据导入吗？',
      detail:
        '选择旧版程序所在文件夹（内含数据库文件），将整体迁移收藏、进度、离线数据库与备份。',
      buttons: ['选择文件夹导入', '跳过'],
      defaultId: 0,
      cancelId: 1
    })
    if (r.response !== 0) return
    const sel = await dialog.showOpenDialog({
      title: '选择旧版程序文件夹',
      properties: ['openDirectory']
    })
    if (sel.canceled || !sel.filePaths?.length) return
    const src = sel.filePaths[0]
    if (!existsSync(join(src, 'acgn-records.db'))) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '导入失败',
        message: '所选文件夹中没有找到数据库文件，已取消导入。'
      })
      return
    }
    for (const [sname, dname] of [['acgn-records.db', 'bangumi-for-pc.db'], ['acgn-records.db-wal', 'bangumi-for-pc.db-wal'], ['acgn-records.db-shm', 'bangumi-for-pc.db-shm'], ['debug.log', 'debug.log']] as const) {
      const s = join(src, sname)
      if (existsSync(s)) copyFileSync(s, join(dir, dname))
    }
    const arc = join(src, 'bangumi-archive')
    if (existsSync(arc)) cpSync(arc, join(dir, 'bangumi-archive'), { recursive: true })
    const bk = join(src, 'backups')
    if (existsSync(bk)) cpSync(bk, join(dir, 'backups'), { recursive: true })
    console.log('[data-dir] 已从旧版文件夹导入:', src)
  } catch (e) {
    console.warn('[data-dir] 导入引导失败（忽略）：', e)
  }
}

app.whenReady().then(() => {
  void maybePromptLegacyImport()
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
  // 启动期清理已过期的只读数据缓存（作品/角色/讨论等），防止 cache 表无限增长
  void deleteExpiredCache().catch((e) => console.warn('[main] 缓存清理失败（忽略）：', e))
  // 图片代理协议：渲染端 acgn-img:// 由主进程（走代理）下载 Bangumi 图片 CDN
  registerImageProxy()

  createWindow()
  buildMenu()
  setupAutoSync()
  setupAutoUpdater()
  // 托盘常驻 + 关闭行为（启动期同步读 settings，运行期经 app:setCloseBehavior 更新）
  closeBehavior = readCloseBehaviorSync()
  createTray()
  ipcMain.handle('app:setCloseBehavior', (_e, v: unknown) => {
    if (v === 'exit' || v === 'minimize') closeBehavior = v
  })
  // 数据目录：供设置页展示实际路径 + 打开数据文件夹
  ipcMain.handle('app:getDataDir', () => {
    const dir = app.getPath('userData')
    // 是否为自定义覆盖（存在 conf 即视为已自定义）
  const confPath = join(app.getPath('appData'), 'bangumi-for-pc', 'data-location.conf')
    return { dir, custom: existsSync(confPath) }
  })
  ipcMain.handle('app:openDataDir', () => {
    void shell.openPath(app.getPath('userData'))
  })
  /** 校验目标 → 关库 → 迁移全部数据文件 → 写/清配置 → 重启应用 */
  async function applySetDataDir(target: string | null): Promise<DataSetDirResult> {
    const cur = app.getPath('userData')
    let newDir: string
    if (target && target.trim()) {
      newDir = join(target.trim())
      if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true })
    } else {
      writeDataDirConf(null) // 清除覆盖，走默认解析链
      newDir = resolveDataDirSync()
    }
    const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
    if (norm(newDir) === norm(cur)) return { ok: true, sameTarget: true }
    // 可写校验
    try {
      const probe = join(newDir, `.write-test-${Date.now()}`)
      writeFileSync(probe, '1')
      rmSync(probe)
    } catch {
      return { ok: false, error: '目标目录不可写' }
    }
    if (existsSync(join(newDir, 'bangumi-for-pc.db'))) {
      return { ok: false, error: '目标文件夹已包含应用数据库，请换一个空文件夹' }
    }
    // 先把网络统计刷进旧库，再关连接
    await flushNetworkNow()
    await closeDb()
    for (const [sname, dname] of [['acgn-records.db', 'bangumi-for-pc.db'], ['acgn-records.db-wal', 'bangumi-for-pc.db-wal'], ['acgn-records.db-shm', 'bangumi-for-pc.db-shm'], ['debug.log', 'debug.log']] as const) {
      const s = join(cur, sname)
      if (existsSync(s)) copyFileSync(s, join(newDir, dname))
    }
    for (const sub of ['bangumi-archive', 'backups']) {
      const s = join(cur, sub)
      if (existsSync(s)) cpSync(s, join(newDir, sub), { recursive: true })
    }
    writeDataDirConf(target && target.trim() ? newDir : null)
    console.log('[data-dir] 数据已迁移:', cur, '->', newDir)
    isQuitting = true
    try { tray?.destroy() } catch { /* ignore */ }
    app.relaunch()
    app.exit(0)
    return { ok: true, path: newDir }
  }
  ipcMain.handle('app:setDataDirResult', async (_e, target: string | null) => applySetDataDir(target))
  // 原生目录选择器 + 迁移重启，一步完成（渲染端无需自己选路径）
  ipcMain.handle('app:pickDataDir', async (): Promise<DataSetDirResult> => {
    const sel = await dialog.showOpenDialog({
      title: '选择新的数据文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (sel.canceled || !sel.filePaths?.length) return { ok: false, canceled: true }
    return applySetDataDir(sel.filePaths[0])
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
