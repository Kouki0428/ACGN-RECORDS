<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { archiveClient } from '@/services/archiveClient'
import { cacheClient } from '@/services/cacheClient'
import { apiClient } from '@/services/apiClient'
import { applyTheme, type ThemePref } from '@/theme'
import { applyUiScale } from '@/scale'
import type { ArchiveMeta, ArchiveProgress, CacheStats, NetworkStatsResult } from '@shared/types'

const auth = useAuthStore()
const settings = useSettingsStore()
const sync = useSyncStore()
const router = useRouter()

const token = ref('')
const saved = ref(false)
const tokenError = ref('')
const busy = ref(false)

const TOKEN_URL = 'https://next.bgm.tv/demo/access-token'

const methodLabel = computed(() => (auth.status.method === 'oauth' ? '应用授权登录' : '个人令牌'))

// 数据目录（安装版默认 exe 同级 userData；可在 data-dir.txt / ACGN_DATA_DIR 覆盖）
const dataDir = ref('')
const dataCustom = ref(false)
const dataBusy = ref(false)
const dataMsg = ref('')
const dataOk = ref(true)

async function refreshDataDir() {
  try {
    const r = await window.acgn.app.getDataDir()
    dataDir.value = r.dir
    dataCustom.value = !!r.custom
  } catch {
    dataDir.value = ''
  }
}

async function openDataFolder() {
  try {
    await apiClient.openDataDir()
  } catch (e) {
    console.warn('[settings] 打开数据目录失败：', e)
  }
}

/** 更改数据目录：主进程校验→迁移→写配置→重启应用 */
async function doChangeDataDir() {
  if (dataBusy.value) return
  dataBusy.value = true
  try {
    const sel = await window.acgn.app.pickDataDir()
    if (!sel.ok) return // 用户取消或失败（失败原因已由主进程对话框提示）
    dataMsg.value = '✓ 数据已迁移，应用即将重启'
    dataOk.value = true
  } finally {
    dataBusy.value = false
  }
}

/** 恢复默认数据位置（清除自定义覆盖后迁移回默认并重启） */
async function doResetDataDir() {
  if (dataBusy.value) return
  dataBusy.value = true
  try {
    const r = await window.acgn.app.setDataDir(null)
    if (r.ok && !r.sameTarget) {
      dataMsg.value = '✓ 已恢复默认数据位置，应用即将重启'
      dataOk.value = true
    }
  } finally {
    dataBusy.value = false
  }
}

// ---------- 应用版本 / 检查更新 ----------
const appVersion = ref('')
const checkingUpdate = ref(false)
const updateMsg = ref('')
const updateOk = ref(true)

async function doCheckUpdate() {
  if (checkingUpdate.value) return
  checkingUpdate.value = true
  updateMsg.value = ''
  try {
    const r = await window.acgn.app.checkUpdate()
    if (!r.ok) {
      updateOk.value = false
      updateMsg.value = '检查失败：' + (r.error ?? '')
      return
    }
    if (r.updateAvailable) {
      updateOk.value = true
      updateMsg.value = `发现新版本 v${r.version}，后台下载完成后会提示重启安装`
    } else {
      updateOk.value = true
      updateMsg.value = `已是最新版本（v${appVersion.value}）`
    }
  } finally {
    checkingUpdate.value = false
  }
}

const REPO_URL = 'https://github.com/Kouki0428/ACGN-RECORDS'
function openRepo() {
  void window.acgn.app.openExternal(REPO_URL)
}

onMounted(async () => {
  await auth.refresh()
  await settings.load()
  gpuLocal.value = settings.gpuAcceleration
  uiScaleLocal.value = settings.uiScale
  gridAnimSpeedLocal.value = settings.gridAnimSpeed
  try {
    const r = await window.acgn.app.getDataDir()
    dataDir.value = r.dir
    dataCustom.value = !!r.custom
  } catch {
    dataDir.value = ''
  }
  try {
    const info = await window.acgn.app.getInfo()
    appVersion.value = info.version
  } catch {
    /* ignore */
  }
  await refreshArchiveMeta()
  await refreshCacheStats()
  await loadNetworkStats()
})

// ---------- Bangumi 离线数据库（Archive） ----------
const archiveMeta = ref<ArchiveMeta | null>(null)
const archiveUpdating = ref(false)
const archiveProgress = ref<ArchiveProgress | null>(null)
const archiveError = ref('')
// 删除离线数据库二次确认 + 进行中状态
const confirmingDeleteArchive = ref(false)
const deletingArchive = ref(false)

function fmtSize(bytes?: number | null): string {
  if (!bytes) return '-'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB'
  return mb.toFixed(0) + ' MB'
}
function relTime(ts?: number | null): string {
  if (!ts) return '从未'
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

async function refreshArchiveMeta() {
  archiveMeta.value = await archiveClient.getMeta()
}

let unsub: (() => void) | null = null
async function doArchiveUpdate() {
  if (archiveUpdating.value) return
  archiveUpdating.value = true
  archiveError.value = ''
  archiveProgress.value = { stage: 'start' }
  unsub?.()
  unsub = archiveClient.onProgress((p) => {
    archiveProgress.value = p
  })
  try {
    const res = await archiveClient.update()
    if (res.status === 'error') archiveError.value = res.error || '更新失败'
  } catch (e) {
    archiveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    unsub?.()
    unsub = null
    archiveUpdating.value = false
    archiveProgress.value = null
    await refreshArchiveMeta()
  }
}

async function doDeleteArchive() {
  if (deletingArchive.value) return
  deletingArchive.value = true
  confirmingDeleteArchive.value = false
  try {
    await archiveClient.delete()
    archiveMeta.value = null
    await refreshCacheStats()
  } catch (e) {
    archiveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deletingArchive.value = false
  }
}

onBeforeUnmount(() => {
  unsub?.()
})

async function login() {
  tokenError.value = ''
  try {
    await auth.login()
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveToken() {
  tokenError.value = ''
  if (!token.value.trim()) {
    tokenError.value = '请先粘贴 Access Token'
    return
  }
  busy.value = true
  try {
    await auth.saveToken(token.value.trim())
    saved.value = true
    token.value = ''
    setTimeout(() => (saved.value = false), 2500)
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function clearToken() {
  await auth.logout()
  saved.value = false
}

const lastText = computed(() => {
  const r = sync.lastResult
  if (!r) return ''
  const parts: string[] = []
  if (r.pushed) parts.push(`已上传 ${r.pushed} 部`)
  if (r.pulled) parts.push(`已拉取 ${r.pulled} 部`)
  if (r.failed) parts.push(`失败 ${r.failed} 部`)
  if (r.deleted) parts.push(`已取消收藏 ${r.deleted} 部`)
  if (r.error) parts.push(`错误：${r.error}`)
  return parts.join('，') || '无变更'
})

async function toggleAutoSync() {
  await settings.set('autoSync', settings.autoSync ? '0' : '1')
}

async function toggleAutoFullPull() {
  await settings.set('autoFullPull', settings.autoFullPull ? '0' : '1')
}

async function toggleArchiveAutoUpdate() {
  await settings.set('archiveAutoUpdate', settings.archiveAutoUpdate ? '0' : '1')
}

async function toggleAutoCacheClean() {
  await settings.set('autoCacheClean', settings.autoCacheClean ? '0' : '1')
}

// ---------- 外观 / 主题 ----------
const themeOptions: { value: ThemePref; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
  { value: 'scheduled', label: '定时' }
]

// 深色风格预设（深色主题下的皮肤）
const darkPresets = [
  { value: 'classic', label: '经典' },
  { value: 'oled', label: 'OLED 纯黑' },
  { value: 'bangumi', label: '粉夜' },
  { value: 'ink', label: '墨绿夜' }
]

// 浅色风格预设（浅色主题下的皮肤）
const lightPresets = [
  { value: 'classic', label: '经典' },
  { value: 'pure', label: '纯白' },
  { value: 'pink', label: '粉白' },
  { value: 'paper', label: '墨绿纸' }
]

// 强调色预设（'' = 默认粉，由「默认」按钮处理）
const accentPresets = [
  { hex: '#ff5c8a', label: '樱粉' },
  { hex: '#f0623d', label: '暖橙' },
  { hex: '#a06bff', label: '紫罗兰' },
  { hex: '#34c98e', label: '青绿' },
  { hex: '#4aa8ff', label: '天蓝' },
  { hex: '#f7b500', label: '琥珀金' }
]
async function setTheme(v: ThemePref, e?: MouseEvent) {
  await settings.set('theme', v) // 先持久化到库
  // View Transitions：以被点按钮为圆心做圆形揭示；onCovered（按钮高亮切换）与新主题同帧原子生效
  const origin = e ? { x: e.clientX, y: e.clientY } : undefined
  void applyTheme(v, () => settings.commitTheme(v), origin)
}

// ---------- 界面缩放（实时生效，无需重启） ----------
// 浏览器式 zoom：作用于整个渲染窗口。滑块 50%–200%，预设 75/100/125/150%。
const scalePresets = [75, 100, 125, 150]
const uiScaleLocal = ref(1)
function onScaleInput(e: Event) {
  const pct = Number((e.target as HTMLInputElement).value)
  setUiScale(pct / 100)
}
function setUiScale(factor: number) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  uiScaleLocal.value = f
  applyUiScale(f) // 实时预览
  void settings.set('uiScale', String(f)) // 持久化，重启后自动恢复
}

// ---------- 卡片重排动画（实时生效，无需重启） ----------
// 滑条语义：0 = 最快（左），1 = 最慢（右），默认 0.2（偏快）。
const gridAnimSpeedLocal = ref(0.2)
function onAnimSpeedInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  gridAnimSpeedLocal.value = v
  void settings.set('gridAnimSpeed', String(v)) // 实时持久化，重启后自动恢复
}
async function toggleGridAnim() {
  await settings.set('gridAnimEnabled', settings.gridAnimEnabled ? '0' : '1')
}

// ---------- GPU 加速（启动期设置，需重启生效） ----------
const gpuLocal = ref(false)
const gpuNeedsRestart = ref(false)
async function toggleGpu() {
  const next = !gpuLocal.value
  gpuLocal.value = next
  await settings.set('gpuAcceleration', next ? '1' : '0')
  gpuNeedsRestart.value = true
}
async function restartApp() {
  try {
    await apiClient.relaunch()
  } catch {
    /* 应用即将退出，忽略 */
  }
}

function openTokenPage() {
  window.acgn.app.openExternal(TOKEN_URL)
}
function openExternal(url: string) {
  window.acgn.app.openExternal(url).catch(() => {})
}

// ---------- 网络代理（手动指定 Clash/v2ray 等，解决 api.bgm.tv 直连超时） ----------
const proxyInput = ref('')
const proxySaving = ref(false)
const proxyMsg = ref('')
onMounted(() => {
  proxyInput.value = settings.proxy
})
async function saveProxy() {
  proxySaving.value = true
  proxyMsg.value = ''
  const val = proxyInput.value.trim()
  try {
    await settings.set('proxy', val)
    await window.acgn.app.setProxy(val || null) // 即时生效，无需重启
    proxyMsg.value = val ? '✓ 代理已保存并立即生效' : '✓ 已清除手动代理（恢复自动探测）'
  } catch (e) {
    proxyMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    proxySaving.value = false
    setTimeout(() => (proxyMsg.value = ''), 3000)
  }
}

// ---------- 缓存管理 ----------
const cacheStats = ref<CacheStats | null>(null)
const confirmingClear = ref(false)
const clearing = ref(false)
const clearMsg = ref('')

const totalCacheCount = computed(() => {
  const s = cacheStats.value
  if (!s) return 0
  return s.episodes + s.characters + s.relations + s.galleries
})

function fmtCount(n?: number | null): string {
  if (n == null) return '-'
  return n.toLocaleString()
}

async function refreshCacheStats() {
  cacheStats.value = await cacheClient.stats()
}

// ---------- 应用网络使用量（当月 + 近 6 月历史） ----------
const netStats = ref<NetworkStatsResult | null>(null)
// 历史列表不含当月（当月已在上方高亮卡片展示），仅展示此前月份用于趋势对比。
const netPast = computed(() => netStats.value?.history.slice(0, -1) ?? [])

async function loadNetworkStats() {
  try {
    netStats.value = await apiClient.getNetworkStats()
  } catch (e) {
    console.error('[settings] 加载网络使用量失败：', e)
  }
}

async function doClearCache() {
  if (clearing.value) return
  clearing.value = true
  clearMsg.value = ''
  try {
    cacheStats.value = await cacheClient.clear()
    clearMsg.value = '✓ 缓存已清理'
    setTimeout(() => (clearMsg.value = ''), 3000)
  } catch (e) {
    clearMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    clearing.value = false
    confirmingClear.value = false
  }
}

// ---------- 备份与恢复 ----------
const backupBusy = ref(false)
const backupMsg = ref('')
const backupOk = ref(false)
// 恢复是高危操作：先点「我要恢复备份」解锁，再点「从备份恢复」
const confirmingRestore = ref(false)

function backupResultText(r: { ok: boolean; canceled?: boolean; path?: string; error?: string }, okText: string): { msg: string; ok: boolean } {
  if (r.canceled) return { msg: '', ok: true }
  if (r.ok) return { msg: `✓ ${okText}${r.path ? '：' + r.path : ''}`, ok: true }
  return { msg: r.error ?? '操作失败', ok: false }
}

async function doExportBackup() {
  if (backupBusy.value) return
  backupBusy.value = true
  backupMsg.value = ''
  try {
    const r = await window.acgn.backup.exportBackup()
    const t = backupResultText(r, '备份已导出')
    backupOk.value = t.ok
    backupMsg.value = t.msg
  } finally {
    backupBusy.value = false
  }
}

async function doImportBackup() {
  if (backupBusy.value || !confirmingRestore.value) return
  backupBusy.value = true
  backupMsg.value = ''
  try {
    const r = await window.acgn.backup.importBackup()
    const t = backupResultText(r, '已从备份恢复')
    backupOk.value = t.ok
    backupMsg.value = t.msg
    confirmingRestore.value = false
  } finally {
    backupBusy.value = false
  }
}

async function doExportCollections(format: 'csv' | 'json') {
  if (backupBusy.value) return
  backupBusy.value = true
  backupMsg.value = ''
  try {
    const r = await window.acgn.backup.exportCollections(format)
    const t = backupResultText(r, format === 'csv' ? '收藏 CSV 已导出' : '收藏 JSON 已导出')
    backupOk.value = t.ok
    backupMsg.value = t.msg
  } finally {
    backupBusy.value = false
  }
}

// ---------- 母级分类（两级设置：/settings 分类卡片 → /settings/:group 详情页） ----------
const props = defineProps<{ group?: string }>()

interface GroupDef {
  key: string
  label: string
  desc: string
  icon: string // 单 path SVG（24 viewBox，描边风格）
}

const GROUPS: GroupDef[] = [
  {
    key: 'account',
    label: '账号与同步',
    desc: 'Bangumi 登录、令牌与进度同步',
    icon: 'M8 21v-2a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'
  },
  {
    key: 'storage',
    label: '储存',
    desc: '离线数据库、缓存管理与备份恢复',
    icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'
  },
  {
    key: 'network',
    label: '网络',
    desc: '代理设置与流量使用统计',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3.6 9h16.8 M3.6 15h16.8 M12 3a15 15 0 0 1 0 18 M12 3a15 15 0 0 0 0 18'
  },
  {
    key: 'appearance',
    label: '个性化',
    desc: '主题、界面缩放与卡片重排动画',
    icon: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a2 2 0 0 1 0-4h4.5A3.5 3.5 0 0 0 21 8.5C21 5.5 17 3 12 3Z M7.5 10.5h.01 M9.5 6.5h.01 M14 5.5h.01'
  },
  {
    key: 'about',
    label: '应用信息',
    desc: '版本号与检查更新',
    icon: 'M12 16v-4 M12 8h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
  }
]

const currentGroup = computed(() => GROUPS.find((g) => g.key === props.group) ?? null)
</script>

<template>
  <div>
    <!-- 母级：分类卡片导航 -->
    <template v-if="!currentGroup">
      <h1>设置</h1>
      <div class="settings-groups">
        <button
          v-for="g in GROUPS"
          :key="g.key"
          type="button"
          class="sg-card"
          @click="router.push(`/settings/${g.key}`)"
        >
          <span class="sg-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path :d="g.icon" />
            </svg>
          </span>
          <span class="sg-text">
            <span class="sg-label">{{ g.label }}</span>
            <span class="sg-desc">{{ g.desc }}</span>
          </span>
          <svg class="sg-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9,5 16,12 9,19" />
          </svg>
        </button>
      </div>
    </template>

    <!-- 子页：分类详情 -->
    <template v-else>
      <header class="view-head">
        <button class="back-btn" type="button" aria-label="返回" @click="router.push('/settings')">
          <svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg>
        </button>
        <h1>{{ currentGroup.label }}</h1>
      </header>

      <template v-if="group === 'account'">
    <!-- Bangumi 账号 -->
    <section class="panel">
      <h2>Bangumi 账号</h2>

      <!-- 登录状态 -->
      <div class="status-line">
        <span
          class="dot"
          :class="auth.status.loggedIn ? 'on' : 'off'"
        ></span>
        <span v-if="auth.status.loggedIn">
          已连接 Bangumi（{{ auth.status.username }}）
          <span class="badge" :class="auth.status.method === 'oauth' ? 'b-oauth' : 'b-token'">
            {{ methodLabel }}
          </span>
        </span>
        <span v-else>未连接</span>
      </div>

      <!-- OAuth 一键登录（推荐） -->
      <p class="hint">
        点击下方按钮，浏览器打开 Bangumi 授权页，同意后即自动登录——无需手动复制令牌。
        应用已内置开发者凭据（硬编码于代码内，无需配置），回调地址固定为
        <code>http://localhost:7321/oauth/callback</code>（请在 Bangumi 应用后台的「回调地址」中登记）。
      </p>
      <div class="row">
        <button
          class="btn btn--primary"
          :disabled="auth.busy"
          @click="login"
        >
          {{ auth.busy ? '等待浏览器授权…' : '用 Bangumi 登录' }}
        </button>
        <span v-if="auth.error" class="err">{{ auth.error }}</span>
      </div>

      <hr class="divider" />

      <!-- 个人令牌（备选） -->
      <p class="hint">
        也可在
        <a href="#" class="link" @click.prevent="openTokenPage">Bangumi 令牌页</a>
        生成 Access Token 并粘贴保存。<strong>不填令牌也能正常检索与本地统计</strong>（检索走匿名接口）。
      </p>
      <label class="field">
        <span>Access Token（备选）</span>
        <textarea
          class="input"
          v-model="token"
          rows="3"
          placeholder="粘贴从 Bangumi 令牌页复制的 token"
        ></textarea>
      </label>
      <div class="row">
        <button class="btn btn--ghost" :disabled="busy || !token.trim()" @click="saveToken">
          保存令牌
        </button>
        <span v-if="saved" class="ok">✓ 已保存</span>
        <span v-if="tokenError" class="err">{{ tokenError }}</span>
      </div>

      <div class="row" style="margin-top: 14px">
        <button v-if="auth.status.loggedIn" class="btn btn--ghost danger" @click="clearToken">
          断开 / 清除登录
        </button>
      </div>
    </section>

    <!-- 同步 -->
    <section class="panel">
      <h2>进度同步</h2>
      <p class="hint">仅在你主动操作时与 Bangumi 通信；本地进度永不自动上传第三方。</p>
      <div class="row">
        <button class="btn btn--accent" :disabled="!auth.status.loggedIn || sync.busy" @click="sync.push">
          上传
        </button>
        <button class="btn btn--accent" :disabled="!auth.status.loggedIn || sync.busy" @click="sync.pull">
          拉取
        </button>
        <button class="btn btn--accent" :disabled="!auth.status.loggedIn || sync.busy" @click="sync.pullFull">
          全量拉取
        </button>
        <button class="btn btn--accent" :disabled="!auth.status.loggedIn || sync.busy" @click="sync.syncAll">
          双向同步
        </button>
      </div>
      <p v-if="sync.busy" class="hint">同步中…</p>
      <p v-if="sync.lastResult" :class="sync.error ? 'err' : 'hint'">上次结果：{{ lastText }}</p>

      <hr class="divider" />
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.autoSync" @change="toggleAutoSync" />
        自动同步进度到 Bangumi（每天）
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.autoFullPull" @change="toggleAutoFullPull" />
        自动全量拉取从 Bangumi（每月）
      </label>
    </section>
      </template>

      <template v-if="group === 'network'">
    <!-- 网络代理 -->
    <section class="panel">
      <h2>网络代理</h2>
      <p class="hint">
        若同步时出现「请求超时（&gt;15000ms）（已尝试：直连）」或「失败 N 部」，通常是主进程无法直连
        <code>api.bgm.tv</code>（如处于需要代理的网络环境）。在此填入你的代理地址即可让主进程走代理，
        <strong>保存后立即生效，无需重启</strong>。常见 Clash 地址：
        <code>http://127.0.0.1:7890</code>（HTTP 代理）或 <code>socks5://127.0.0.1:7890</code>（混合端口）。
        留空则自动探测系统/环境代理与本机常见端口。
      </p>
      <label class="field">
        <span>代理地址（可选）</span>
        <input
          class="input"
          v-model="proxyInput"
          placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7890"
          @keyup.enter="saveProxy"
        />
      </label>
      <div class="row" style="margin-top: 12px">
        <button class="btn btn--primary" :disabled="proxySaving" @click="saveProxy">
          {{ proxySaving ? '保存中…' : '保存代理' }}
        </button>
        <span v-if="proxyMsg" :class="proxyMsg.startsWith('✓') ? 'ok' : 'err'">{{ proxyMsg }}</span>
      </div>
    </section>

    <!-- 网络使用量 -->
    <section class="panel">
      <h2>网络使用量</h2>
      <p class="hint">
        统计本应用通过 Bangumi 同步、离线库更新、检索增强（TMDB/VNDB）等发起的网络请求的上行 / 下行流量与次数。
        <strong>仅本地记录，不上传。</strong>
      </p>

      <div class="arc-status" v-if="netStats?.current">
        <div class="arc-stat"><span>当月上传</span><b>{{ fmtSize(netStats.current.sent) }}</b></div>
        <div class="arc-stat"><span>当月下载</span><b>{{ fmtSize(netStats.current.received) }}</b></div>
        <div class="arc-stat"><span>当月请求次数</span><b>{{ fmtCount(netStats.current.requests) }}</b></div>
        <div class="arc-stat"><span>当月合计</span><b>{{ fmtSize(netStats.current.sent + netStats.current.received) }}</b></div>
      </div>
      <p v-else-if="netStats" class="hint">本月尚无网络请求记录。</p>
      <p v-else class="hint">正在统计网络使用量…</p>

      <div class="net-history" v-if="netPast.length">
        <div class="net-hrow net-hhead">
          <span>月份</span><span>上行</span><span>下行</span><span>请求</span>
        </div>
        <div class="net-hrow" v-for="h in netPast" :key="h.month">
          <span>{{ h.month }}</span>
          <span>{{ fmtSize(h.sent) }}</span>
          <span>{{ fmtSize(h.received) }}</span>
          <span>{{ fmtCount(h.requests) }}</span>
        </div>
      </div>
    </section>
      </template>

      <template v-if="group === 'appearance'">
    <!-- 主题与色彩 -->
    <section class="panel">
      <h2>主题与色彩</h2>
      <p class="hint">选择界面主题。“跟随系统”随操作系统自动切换；“定时”按下方时段自动切换。</p>
      <div class="seg">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          class="seg-item"
          :class="{ active: settings.theme === opt.value }"
          @click="setTheme(opt.value, $event)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- 定时切换时段（仅 theme=scheduled 时显示） -->
      <div v-if="settings.theme === 'scheduled'" class="sched-row">
        <label class="sched-field">
          <span>浅色起</span>
          <input type="time" class="input" :value="settings.scheduleLight" @change="settings.set('scheduleLight', ($event.target as HTMLInputElement).value)" />
        </label>
        <span class="sched-arrow">→</span>
        <label class="sched-field">
          <span>深色起</span>
          <input type="time" class="input" :value="settings.scheduleDark" @change="settings.set('scheduleDark', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <!-- 主题风格预设（深/浅各自一套，切换主题时分别生效） -->
      <hr class="divider" />
      <p class="hint">深色风格——切换到深色主题时的外观。</p>
      <div class="seg">
        <button
          v-for="p in darkPresets"
          :key="p.value"
          type="button"
          class="seg-item"
          :class="{ active: settings.darkPreset === p.value }"
          @click="settings.set('darkPreset', p.value)"
        >
          {{ p.label }}
        </button>
      </div>
      <p class="hint" style="margin-top: 12px">浅色风格——切换到浅色主题时的外观。</p>
      <div class="seg">
        <button
          v-for="p in lightPresets"
          :key="p.value"
          type="button"
          class="seg-item"
          :class="{ active: settings.lightPreset === p.value }"
          @click="settings.set('lightPreset', p.value)"
        >
          {{ p.label }}
        </button>
      </div>

      <!-- 自定义强调色 -->
      <hr class="divider" />
      <p class="hint">强调色：按钮渐变、激活态、边框高亮等全局强调元素随之换色。</p>
      <div class="accent-row">
        <button
          v-for="c in accentPresets"
          :key="c.hex"
          type="button"
          class="accent-swatch"
          :class="{ active: settings.accentColor === c.hex }"
          :style="{ background: c.hex }"
          :title="c.label"
          @click="settings.set('accentColor', c.hex)"
        ></button>
        <!-- 自定义颜色：色块显示当前强调色+白色加号，点击唤起系统取色器 -->
        <label
          class="accent-swatch accent-custom"
          :class="{ active: isCustomAccent }"
          title="自定义颜色"
        >
          <input
            type="color"
            :value="settings.accentColor || '#ff5c8a'"
            @input="settings.set('accentColor', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button
          type="button"
          class="accent-reset"
          :class="{ active: !settings.accentColor }"
          @click="settings.set('accentColor', '')"
        >默认</button>
      </div>
      </section>

    <!-- 布局与显示 -->
    <section class="panel">
      <h2>布局与显示</h2>
      <p class="hint">界面整体缩放与详情页装饰元素。</p>
      <div class="scale-control">
        <div class="scale-head">
          <span>界面缩放</span>
          <span class="scale-val">{{ Math.round(uiScaleLocal * 100) }}%</span>
        </div>
        <input
          class="scale-range"
          type="range"
          min="50"
          max="200"
          step="5"
          :value="Math.round(uiScaleLocal * 100)"
          @input="onScaleInput"
        />
        <div class="seg scale-presets">
          <button
            v-for="p in scalePresets"
            :key="p"
            class="seg-item"
            :class="{ active: Math.round(uiScaleLocal * 100) === p }"
            @click="setUiScale(p / 100)"
          >
            {{ p }}%
          </button>
        </div>
        <p class="hint">实时预览，立即生效；重启应用后自动恢复。</p>
      </div>
      <hr class="divider" />
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.detailBanner" @change="settings.set('detailBanner', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        详情页封面横幅背景（模糊放大的封面作顶部装饰）
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.anchorBarEnabled" @change="settings.set('anchorBarEnabled', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        快捷跳转栏（详情页与作品悬浮窗顶部的锚点导航）
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.immersiveGlow" @change="settings.set('immersiveGlow', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        沉浸光感
      </label>
    </section>

    <!-- 作品栏区块 -->
    <section class="panel">
      <h2>作品栏区块</h2>
      <p class="hint" style="margin: 0 0 6px">控制详情页与悬浮窗中各区块的显示。</p>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showCharacters" @change="settings.set('showCharacters', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        角色
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showVolumes" @change="settings.set('showVolumes', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        单行本
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showRelations" @change="settings.set('showRelations', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        关联条目
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showTopics" @change="settings.set('showTopics', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        讨论版
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showTucao" @change="settings.set('showTucao', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        吐槽箱
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showGallery" @change="settings.set('showGallery', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        游戏画廊（仅 Galgame）
      </label>
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.showPurchase" @change="settings.set('showPurchase', ($event.target as HTMLInputElement).checked ? '1' : '0')" />
        购买信息（仅 Galgame）
      </label>
    </section>

    <!-- 性能 -->
    <section class="panel">
      <h2>性能</h2>
      <label class="progress-editor">
        <input type="checkbox" :checked="gpuLocal" @change="toggleGpu" />
        启用 GPU 硬件加速
      </label>
      <p class="hint">
        若软件出现渲染问题，可通过关闭GPU加速来解决。
      </p>
      <div class="row" v-if="gpuNeedsRestart">
        <span class="warn-text">GPU 加速设置已更改，需重启应用生效：</span>
        <button class="btn btn--accent" @click="restartApp">立即重启</button>
      </div>
    </section>

    <!-- 动画 -->
    <section class="panel">
      <h2>动画</h2>
      <p class="hint">控制主页 / 长列表卡片在窗口缩放、侧栏收起导致列数变化时的重排过渡。</p>
      <div class="anim-control">
        <label class="progress-editor">
          <input type="checkbox" :checked="settings.gridAnimEnabled" @change="toggleGridAnim" />
          卡片重排动画（窗口缩放 / 侧栏收起导致列数变化时）
        </label>
        <div class="scale-control" :class="{ disabled: !settings.gridAnimEnabled }">
          <div class="scale-head">
            <span>动画速度</span>
            <span class="scale-val">{{ Math.round(gridAnimSpeedLocal * 100) }}%</span>
          </div>
          <input
            class="scale-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="gridAnimSpeedLocal"
            :disabled="!settings.gridAnimEnabled"
            @input="onAnimSpeedInput"
          />
          <div class="scale-ends">
            <span>快</span>
            <span>慢</span>
          </div>
          <p class="hint">左快右慢；关闭上方开关即瞬间重排、无过渡。</p>
        </div>
      </div>
    </section>

      </template>

      <template v-if="group === 'storage'">
    <!-- Bangumi 离线数据库 -->
    <section class="panel">
      <h2>Bangumi 离线数据库</h2>
      <p class="hint">
        内置 Bangumi 官方每周导出的全量 wiki 数据（<a class="link" href="#" @click.prevent="openExternal('https://github.com/bangumi/Archive')">bangumi/Archive</a>）。
        下载并解析后，详情页的<strong>角色 / 关联条目 / 声优</strong>即使未登录也能离线显示。
        应用会<strong>每 30 天自动静默更新</strong>一次（也可点击下方手动更新）。
      </p>

      <label class="progress-editor">
        <input type="checkbox" :checked="settings.archiveAutoUpdate" @change="toggleArchiveAutoUpdate" />
        每 30 天自动更新离线数据库
      </label>

      <div class="arc-status" v-if="archiveMeta">
        <div class="arc-stat"><span>版本</span><b>{{ archiveMeta.version || '-' }}</b></div>
        <div class="arc-stat"><span>导出日期</span><b>{{ archiveMeta.date || '-' }}</b></div>
        <div class="arc-stat"><span>体积</span><b>{{ fmtSize(archiveMeta.size) }}</b></div>
        <div class="arc-stat"><span>本地占用</span><b>{{ fmtSize(cacheStats?.archiveSize) }}</b></div>
        <div class="arc-stat"><span>上次更新</span><b>{{ relTime(archiveMeta.lastSuccessAt) }}</b></div>
        <div class="arc-stat">
          <span>状态</span>
          <b :class="archiveMeta.status === 'ok' ? 'ok' : (archiveMeta.status === 'error' ? 'err' : '')">
            {{ archiveMeta.status === 'ok' ? '正常' : (archiveMeta.status === 'error' ? '失败' : '未初始化') }}
          </b>
        </div>
      </div>
      <p v-else class="hint">尚未下载离线数据库。</p>

      <div class="row" style="margin-top: 12px">
        <button class="btn btn--primary" :disabled="archiveUpdating" @click="doArchiveUpdate">
          {{ archiveUpdating ? '更新中…' : (archiveMeta ? '立即更新' : '下载离线数据库') }}
        </button>
        <button
          v-if="archiveMeta"
          class="btn btn--ghost danger"
          :disabled="archiveUpdating || deletingArchive"
          @click="confirmingDeleteArchive = true"
        >
          删除离线数据库
        </button>
        <span v-if="archiveUpdating && archiveProgress?.stage === 'download'" class="ok">
          {{ (archiveProgress.downloaded! / 1048576 || 0).toFixed(0) }} / {{ (archiveProgress.total! / 1048576 || 0).toFixed(0) }} MB
        </span>
      </div>
      <p v-if="archiveMeta" class="hint" style="margin-top: 8px">
        删除离线数据库将释放本地约 {{ fmtSize(cacheStats?.archiveSize) }} 数据，删除后需重新下载整库才能恢复离线功能。
      </p>

      <div v-if="archiveProgress && archiveUpdating" class="arc-progress">
        <div v-if="archiveProgress.stage === 'download'" class="arc-bar">
          <div
            class="arc-bar-fill"
            :style="{ width: archiveProgress.total ? (archiveProgress.downloaded! / archiveProgress.total * 100) + '%' : '0%' }"
          ></div>
        </div>
        <p v-else-if="archiveProgress.stage === 'extract'" class="hint">解压中…</p>
        <p v-else-if="archiveProgress.stage === 'ingest'" class="hint">
          入库中：{{ archiveProgress.table }}（已处理 {{ (archiveProgress.count || 0).toLocaleString() }} 行）
        </p>
        <p v-else-if="archiveProgress.stage === 'done'" class="ok">{{ archiveProgress.message }}</p>
        <p v-else-if="archiveProgress.stage === 'error'" class="err">{{ archiveProgress.message }}</p>
      </div>
      <p v-if="archiveError" class="err">{{ archiveError }}</p>
    </section>

    <!-- 缓存管理 -->
    <section class="panel">
      <h2>缓存管理</h2>
      <p class="hint">
        以下为<strong>可重新抓取</strong>的本地辅助缓存（剧集元数据 / 角色声优 / 关联作品 / 画廊截图链接）。
        清理后再次打开作品详情会自动重新拉取，<strong>不影响你的收藏、进度与已发评论</strong>。
        Bangumi 离线数据库为独立数据，不随此清理删除（在上方单独管理）。
      </p>

      <div class="arc-status" v-if="cacheStats">
        <div class="arc-stat"><span>主数据库</span><b>{{ fmtSize(cacheStats.dbSize) }}</b></div>
        <div class="arc-stat"><span>剧集缓存</span><b>{{ fmtCount(cacheStats.episodes) }} 条</b></div>
        <div class="arc-stat"><span>角色/声优缓存</span><b>{{ fmtCount(cacheStats.characters) }} 条</b></div>
        <div class="arc-stat"><span>关联作品缓存</span><b>{{ fmtCount(cacheStats.relations) }} 条</b></div>
        <div class="arc-stat"><span>画廊缓存</span><b>{{ fmtCount(cacheStats.galleries) }} 条</b></div>
        <div class="arc-stat"><span>图片字节缓存</span><b>{{ fmtSize(cacheStats.imageCacheSize) }}</b></div>
      </div>
      <p v-else class="hint">正在统计缓存…</p>

      <label class="progress-editor" style="margin-top: 14px">
        <input type="checkbox" :checked="settings.autoCacheClean" @change="toggleAutoCacheClean" />
        自动清理过期缓存（每月，删除半年未更新的辅助缓存）
      </label>
      <p class="hint">
        开启后，应用每月会静默删除「半年以上未刷新」的角色 / 关联 / 剧集 / 画廊缓存，
        仅在再次打开作品时重新拉取（不影响收藏、进度与已发评论）。关闭后需手动清理。
      </p>

      <div class="row" style="margin-top: 12px">
        <button class="btn btn--ghost danger" :disabled="clearing" @click="confirmingClear = true">
          {{ clearing ? '清理中…' : '清理缓存' }}
        </button>
        <span v-if="clearMsg" :class="clearMsg.startsWith('✓') ? 'ok' : 'err'">{{ clearMsg }}</span>
      </div>
    </section>

    <!-- 备份与恢复 -->
    <section class="panel">
      <h2>备份与恢复</h2>
      <p class="hint">
        将<strong>全部个人数据</strong>（收藏 / 进度 / 评分 / 吐槽 / 购买记录 / 设置）导出为一个数据库文件；
        恢复时会<strong>自动先把当前库留存应急副本</strong>（userData/backups）再覆盖。
        不含 Bangumi 离线库与图片字节缓存。
      </p>
      <div class="row" style="margin-top: 12px; align-items: center">
        <span class="hint" style="margin: 0">数据目录：</span>
        <code class="datadir-path" :title="dataDir">{{ dataDir || '读取中…' }}</code>
        <button class="btn btn--ghost btn--sm" :disabled="!dataDir" @click="openDataFolder">打开文件夹</button>
        <button class="btn btn--ghost btn--sm" :disabled="dataBusy" @click="doChangeDataDir">修改…</button>
        <button
          v-if="dataCustom"
          class="btn btn--ghost btn--sm"
          :disabled="dataBusy"
          @click="doResetDataDir"
        >恢复默认位置</button>
      </div>
      <p v-if="dataMsg" :class="dataOk ? 'ok' : 'err'" style="margin-top: 8px">{{ dataMsg }}</p>

      <div class="row" style="margin-top: 12px">
        <button class="btn btn--primary" :disabled="backupBusy" @click="doExportBackup">
          {{ backupBusy ? '处理中…' : '导出备份' }}
        </button>
        <button class="btn btn--ghost" :disabled="backupBusy || !confirmingRestore" @click="doImportBackup">
          从备份恢复…
        </button>
        <button v-if="!confirmingRestore" class="btn btn--ghost danger" :disabled="backupBusy" @click="confirmingRestore = true">
          我要恢复备份
        </button>
        <button v-else class="btn btn--ghost" :disabled="backupBusy" @click="confirmingRestore = false">取消恢复意图</button>
      </div>
      <p class="hint">
        「恢复」会<strong>整体替换</strong>当前所有数据（恢复后自动重启数据连接）；请确认备份来源可信。
      </p>

      <!-- 收藏数据轻量导出（CSV/JSON） -->
      <hr class="divider" />
      <p class="hint">
        导出收藏为表格文件（标题 / 分类 / 状态 / 评分 / 进度 / 吐槽 / 标记时间 / 链接）。
        CSV 可直接用 Excel 打开；JSON 为结构化格式。<strong>单向导出，不能导回应用。</strong>
      </p>
      <div class="row" style="margin-top: 10px">
        <button class="btn btn--ghost" :disabled="backupBusy" @click="doExportCollections('csv')">导出收藏 CSV</button>
        <button class="btn btn--ghost" :disabled="backupBusy" @click="doExportCollections('json')">导出收藏 JSON</button>
      </div>
      <p v-if="backupMsg" :class="backupOk ? 'ok' : 'err'" style="margin-top: 8px">{{ backupMsg }}</p>
    </section>
      </template>

      <template v-if="group === 'about'">
    <!-- 应用信息 -->
    <section class="panel">
      <h2>应用信息</h2>
      <div class="row" style="align-items: center; margin: 0">
        <span class="hint" style="margin: 0">当前版本：</span>
        <b style="font-size: 13px">v{{ appVersion }}</b>
        <button class="btn btn--primary btn--sm" :disabled="checkingUpdate" @click="doCheckUpdate">
          {{ checkingUpdate ? '检查中…' : '检查更新' }}
        </button>
      </div>
      <p v-if="updateMsg" :class="updateOk ? 'ok' : 'err'" style="margin-top: 10px">{{ updateMsg }}</p>
      <p v-else class="hint">
        应用启动时会自动检查一次更新；发现新版本后会在后台下载，完成后提示重启安装。
        更新只替换程序文件，数据目录不受影响。
      </p>

      <!-- GitHub 仓库 -->
      <hr class="divider" />
      <div class="row" style="align-items: center; margin: 0">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" style="color:var(--text-dim);flex-shrink:0" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.91-2.6 5.59-2.15 5.59-2.15zm0 0z"/>
        </svg>
        <span class="hint" style="margin: 0">GitHub 仓库：</span>
        <button class="btn btn--ghost btn--sm" @click="openRepo">Kouki0428/ACGN-RECORDS</button>
      </div>

      <!-- 关闭行为 -->
      <hr class="divider" />
      <label class="progress-editor">
        <input type="checkbox" :checked="settings.closeBehavior === 'minimize'" @change="settings.set('closeBehavior', ($event.target as HTMLInputElement).checked ? 'minimize' : 'exit')" />
        关闭按钮最小化到托盘（后台同步继续；从托盘菜单可真正退出）
      </label>
    </section>
      </template>
    </template><!-- /v-else 分类详情 -->

    <!-- 清理缓存二次确认 -->
    <div v-if="confirmingClear" class="modal-mask" @click.self="confirmingClear = false">
      <div class="modal">
        <h3>确认清理缓存？</h3>
        <p class="modal-text">
          将清除本机缓存
          <b>{{ fmtCount(totalCacheCount) }}</b>
          项（剧集 {{ fmtCount(cacheStats?.episodes) }} / 角色声优 {{ fmtCount(cacheStats?.characters) }} /
          关联作品 {{ fmtCount(cacheStats?.relations) }} / 画廊 {{ fmtCount(cacheStats?.galleries) }}）。
          <br />此操作<strong>不可撤销</strong>，但不会影响收藏、进度与已发评论（清理后会自动重新抓取）。
        </p>
        <div class="modal-actions">
          <button class="btn btn--ghost" :disabled="clearing" @click="confirmingClear = false">取消</button>
          <button class="btn btn--ghost danger" :disabled="clearing" @click="doClearCache">
            {{ clearing ? '清理中…' : '确认清除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除离线数据库二次确认 -->
    <div v-if="confirmingDeleteArchive" class="modal-mask" @click.self="confirmingDeleteArchive = false">
      <div class="modal">
        <h3>⚠️ 危险操作：确认永久删除离线数据库？</h3>
        <p class="modal-text">
          此操作将<strong>永久、不可逆地删除</strong>本机离线数据库（约 {{ fmtSize(cacheStats?.archiveSize) }}，包含 Bangumi 全量 wiki 镜像）。
          <br /><strong>删除后你将立即丢失：</strong>所有作品的<strong>站点评分与排名、评分分布</strong>，以及角色 / 声优 / 关联作品 / 封面等离线兜底数据。
          此后打开任意作品，这些内容都<strong>无法再本地秒显</strong>，只能实时联网拉取——无网络或网络慢时会<strong>直接空白或长时间转圈</strong>。
          <br /><strong>要恢复，必须重新下载</strong>整库压缩包（约 400MB+，解压入库后本地占用更大），耗时较长且<strong>依赖网络</strong>，完全不像清理缓存那样能自动补回。
          <br />注意：此删除<strong>不影响</strong>你的收藏、进度、已发评论与购买记录（那些在主数据库）；但离线评分 / 角色等一旦删掉，就只能重新下载整库才能找回来。
          <br /><strong>此操作不可撤销，请务必三思！</strong>
        </p>
        <div class="modal-actions">
          <button class="btn btn--ghost" :disabled="deletingArchive" @click="confirmingDeleteArchive = false">取消</button>
          <button class="btn btn--ghost danger" :disabled="deletingArchive" @click="doDeleteArchive">
            {{ deletingArchive ? '删除中…' : '我已知后果，永久删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin-bottom: 6px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.dot.on {
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}
.dot.off {
  background: var(--text-dim);
}
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  margin-left: 4px;
  font-weight: 600;
}
.b-oauth {
  background: rgba(74, 144, 226, 0.18);
  color: #6db0ff;
}
.b-token {
  background: rgba(232, 85, 45, 0.18);
  color: #ff8a5c;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0 12px;
}
.progress-editor {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 13px;
}
.seg {
  display: inline-flex;
  gap: 6px;
  margin-top: 12px;
  padding: 4px;
  background: var(--bg-elev);
  border-radius: 10px;
}
.seg-item {
  padding: 7px 16px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg-item:hover {
  color: var(--text);
}
.seg-item.active {
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-soft);
}
.scale-control {
  margin-top: 14px;
}
.scale-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.scale-val {
  color: var(--accent);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.scale-range {
  width: 100%;
  margin: 10px 0 4px;
  accent-color: var(--accent);
  cursor: pointer;
}
.scale-presets {
  margin-top: 8px;
}
.scale-ends {
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 2px;
}
.anim-control {
  margin-top: 14px;
}
.anim-control .scale-control.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.link {
  color: var(--accent);
  font-size: 13px;
}
.hint {
  color: var(--text-dim);
  font-size: 13px;
}
.hint code {
  background: var(--bg-elev);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.ok {
  color: var(--ok);
  font-size: 13px;
  font-weight: 600;
}
.err {
  color: var(--err);
  font-size: 13px;
}
.btn.danger {
  color: var(--err);
  border-color: var(--err);
}
.btn.danger:hover {
  background: rgba(255, 107, 107, 0.12);
}
.arc-status {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px 16px;
  margin-top: 12px;
}
.arc-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.arc-stat span {
  font-size: 12px;
  color: var(--text-dim);
}
.arc-stat b {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}
.net-history {
  margin-top: 14px;
  border: 1px solid var(--border, #2a3342);
  border-radius: 10px;
  overflow: hidden;
}
.net-hrow {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 0.8fr;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  align-items: center;
}
.net-hrow + .net-hrow {
  border-top: 1px solid var(--border, #2a3342);
}
.net-hhead {
  background: var(--bg-elev, #1c2230);
  color: var(--text-dim);
  font-weight: 600;
}
.net-hrow span:not(:first-child) {
  text-align: right;
  color: var(--text);
}
.arc-progress {
  margin-top: 10px;
}
.arc-bar {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--bg-elev, #1c2230);
  overflow: hidden;
}
.arc-bar-fill {
  height: 100%;
  background: var(--accent, #f09199);
  transition: width 0.2s;
}
.arc-sub {
  margin: 6px 0 10px;
  font-size: 14px;
}
.warn-text {
  color: var(--accent, #f09199);
  font-size: 13px;
  font-weight: 600;
}
.arc-search {
  flex: 1;
  min-width: 200px;
}
.arc-results {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border, #2a3342);
  border-radius: 10px;
}
.arc-results li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #2a3342);
  cursor: pointer;
  transition: background 0.12s;
}
.arc-results li:last-child {
  border-bottom: none;
}
.arc-results li:hover {
  background: var(--bg-elev, #1c2230);
}
.arc-res-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.arc-res-sub {
  font-size: 12px;
  color: var(--text-dim);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arc-res-score {
  font-size: 12px;
  color: var(--accent, #f09199);
  font-weight: 600;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  width: 440px;
  max-width: calc(100vw - 40px);
  background: var(--bg-panel, #1b2029);
  border: 1px solid var(--border, #2a3342);
  border-radius: 14px;
  padding: 22px 22px 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.modal h3 {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--text);
}
.modal-text {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-dim);
  margin: 0 0 16px;
}
.modal-text b {
  color: var(--accent, #f09199);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.datadir-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 5px 9px;
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 外观区：定时时段 / 强调色板 ===== */
.sched-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.sched-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.sched-field .input {
  width: 120px;
  padding: 6px 10px;
}
.sched-arrow {
  color: var(--text-dim);
}
.accent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.accent-swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s var(--ease-out), box-shadow var(--dur-fast);
}
.accent-swatch:hover {
  transform: scale(1.12);
}
.accent-swatch.active {
  box-shadow: 0 0 0 2px var(--bg-panel), 0 0 0 4px var(--text);
}
/* 自定义颜色入口：色块显示当前强调色，中间白色加号；内嵌透明取色器 */
.accent-custom {
  position: relative;
  background: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.accent-custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.accent-custom::before,
.accent-custom::after {
  content: '';
  position: absolute;
  background: #fff;
  border-radius: 2px;
  pointer-events: none;
}
.accent-custom::before {
  width: 12px;
  height: 2px;
}
.accent-custom::after {
  width: 2px;
  height: 12px;
}
.accent-reset {
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.accent-reset:hover {
  color: var(--text);
  border-color: var(--border-hover);
}
.accent-reset.active {
  color: var(--text);
  border-color: var(--accent-2);
}

/* ===== 母级分类卡片（/settings 导航页）===== */.settings-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.sg-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 16px;
  text-align: left;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    transform 0.15s var(--ease-out),
    border-color var(--dur-fast) ease,
    box-shadow var(--dur) ease;
}
.sg-card:hover {
  transform: translateY(-3px);
  border-color: var(--accent-2);
  box-shadow: var(--shadow);
}
.sg-card:active {
  transform: translateY(-1px) scale(0.99);
}
.sg-icon {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--bg-elev);
  color: var(--accent-2);
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.sg-card:hover .sg-icon {
  background: var(--accent-2);
  color: #fff;
}
.sg-icon svg {
  width: 22px;
  height: 22px;
}
.sg-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sg-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.sg-desc {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.45;
}
.sg-chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-dim);
  transition: transform var(--dur-fast) ease, color var(--dur-fast) ease;
}
.sg-card:hover .sg-chevron {
  transform: translateX(3px);
  color: var(--accent-2);
}
</style>
