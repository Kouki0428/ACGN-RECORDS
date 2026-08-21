<script setup lang="ts">
import { onMounted, onBeforeUnmount, onUnmounted, ref, computed, watch } from 'vue'
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

const token = ref('')
const saved = ref(false)
const tokenError = ref('')
const busy = ref(false)

const TOKEN_URL = 'https://next.bgm.tv/demo/access-token'

const methodLabel = computed(() => (auth.status.method === 'oauth' ? '应用授权登录' : '个人令牌'))

onMounted(async () => {
  await auth.refresh()
  await settings.load()
  gpuLocal.value = settings.gpuAcceleration
  uiScaleLocal.value = settings.uiScale
  gridAnimSpeedLocal.value = settings.gridAnimSpeed
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
  { value: 'system', label: '跟随系统' }
]
async function setTheme(v: ThemePref) {
  await settings.set('theme', v) // 先持久化到库
  // 截旧画面 → 盖遮罩（显示旧高亮）→ 切按钮高亮（被遮，不可见）→ 切根主题 → 扫开
  void applyTheme(v, () => settings.commitTheme(v))
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

// ---------- 分区导航（左侧锚点目录 + 关键词过滤） ----------
interface SectionDef {
  key: string
  label: string
  kw: string
}
const sectionDefs: SectionDef[] = [
  { key: 'account', label: 'Bangumi 账号', kw: '登录 令牌 token 授权 oauth 账号 access' },
  { key: 'sync', label: '进度同步', kw: '同步 上传 拉取 全量 自动 push pull' },
  { key: 'proxy', label: '网络代理', kw: '代理 proxy 网络 clash 端口 socks http' },
  { key: 'appearance', label: '外观', kw: '主题 深色 浅色 缩放 外观 跟随系统' },
  { key: 'animation', label: '动画', kw: '卡片 重排 动画 速度 开关 网格' },
  { key: 'offline', label: '离线数据库', kw: '离线 数据库 下载 更新 删除 archive 镜像' },
  { key: 'cache', label: '缓存管理', kw: '缓存 清理 图片 字节 过期' },
  { key: 'backup', label: '备份与恢复', kw: '备份 恢复 导出 导入 应急' },
  { key: 'usage', label: '网络使用量', kw: '流量 使用量 网络 统计 上传 下载' }
]
const activeSection = ref('account')
const filterKw = ref('')
const sectionEls: Record<string, HTMLElement | null> = {}
function setSectionRef(key: string) {
  return (el: unknown) => {
    sectionEls[key] = (el as HTMLElement) ?? null
  }
}
/** 关键词过滤：匹配分区名或关键词串；空关键词全显示 */
function sectionVisible(key: string): boolean {
  const q = filterKw.value.trim().toLowerCase()
  if (!q) return true
  const def = sectionDefs.find((d) => d.key === key)
  if (!def) return true
  return `${def.label} ${def.kw}`.toLowerCase().includes(q)
}
const tocItems = computed(() => sectionDefs.filter((d) => sectionVisible(d.key)))
let secRaf = 0
function updateActiveSection() {
  let cur = sectionDefs[0]?.key ?? ''
  for (const d of sectionDefs) {
    const el = sectionEls[d.key]
    // 被过滤隐藏的分区跳过（display:none 时 offsetParent 为 null / 高度 0）
    if (!el || el.offsetHeight === 0) continue
    if (el.getBoundingClientRect().top <= 140) cur = d.key
  }
  activeSection.value = cur
}
function onSettingsScroll() {
  if (secRaf) return
  secRaf = requestAnimationFrame(() => {
    secRaf = 0
    updateActiveSection()
  })
}
function jumpToSection(key: string) {
  const el = sectionEls[key]
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(() => {
  document.querySelector('.content')?.addEventListener('scroll', onSettingsScroll, { passive: true })
})
onUnmounted(() => {
  document.querySelector('.content')?.removeEventListener('scroll', onSettingsScroll)
  if (secRaf) cancelAnimationFrame(secRaf)
})
watch(filterKw, () => {
  // 过滤后布局变化，下一帧重算高亮
  requestAnimationFrame(updateActiveSection)
})
</script>

<template>
  <div class="settings-layout">
    <!-- 左侧锚点目录 + 过滤（sticky 跟随滚动） -->
    <aside class="settings-toc">
      <input
        v-model="filterKw"
        type="text"
        class="input toc-filter"
        placeholder="筛选设置…"
        aria-label="筛选设置项"
      />
      <button
        v-for="d in tocItems"
        :key="d.key"
        type="button"
        class="toc-item"
        :class="{ active: activeSection === d.key }"
        @click="jumpToSection(d.key)"
      >
        {{ d.label }}
      </button>
    </aside>

    <div class="settings-main">
    <h1>设置</h1>

    <!-- Bangumi 账号 -->
    <section v-show="sectionVisible('account')" :ref="setSectionRef('account')" class="panel">
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
    <section v-show="sectionVisible('sync')" :ref="setSectionRef('sync')" class="panel">
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

    <!-- 网络代理 -->
    <section v-show="sectionVisible('proxy')" :ref="setSectionRef('proxy')" class="panel">
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

    <!-- 外观 -->
    <section v-show="sectionVisible('appearance')" :ref="setSectionRef('appearance')" class="panel">
      <h2>外观</h2>
      <p class="hint">选择界面主题。选择“跟随系统”时，会随操作系统的浅色 / 深色模式自动切换。</p>
      <div class="seg">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          class="seg-item"
          :class="{ active: settings.theme === opt.value }"
          @click="setTheme(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <hr class="divider" />

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
    <section v-show="sectionVisible('animation')" :ref="setSectionRef('animation')" class="panel">
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

    <!-- Bangumi 离线数据库 -->
    <section v-show="sectionVisible('offline')" :ref="setSectionRef('offline')" class="panel">
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
    <section v-show="sectionVisible('cache')" :ref="setSectionRef('cache')" class="panel">
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
    <section v-show="sectionVisible('backup')" :ref="setSectionRef('backup')" class="panel">
      <h2>备份与恢复</h2>
      <p class="hint">
        将<strong>全部个人数据</strong>（收藏 / 进度 / 评分 / 吐槽 / 购买记录 / 设置）导出为一个数据库文件；
        恢复时会<strong>自动先把当前库留存应急副本</strong>（userData/backups）再覆盖。
        不含 Bangumi 离线库与图片字节缓存。
      </p>
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
      <p v-if="backupMsg" :class="backupOk ? 'ok' : 'err'" style="margin-top: 8px">{{ backupMsg }}</p>
    </section>

    <!-- 网络使用量 -->
    <section v-show="sectionVisible('usage')" :ref="setSectionRef('usage')" class="panel">
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
    </div><!-- /settings-main -->
  </div><!-- /settings-layout -->
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

/* ===== 分区导航（左侧锚点目录 + 过滤）===== */
.settings-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.settings-toc {
  position: sticky;
  top: 0;
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 2px;
}
.toc-filter {
  margin-bottom: 8px;
  padding: 7px 10px;
  font-size: 13px;
}
.toc-item {
  text-align: left;
  padding: 7px 11px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color var(--dur-fast) ease,
    background var(--dur-fast) ease,
    transform 0.12s var(--ease-out);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-item:hover {
  color: var(--text);
  background: var(--bg-elev);
}
.toc-item:active {
  transform: scale(0.97);
}
.toc-item.active {
  color: var(--nav-active-text);
  background: var(--bg-elev);
  box-shadow: inset 3px 0 0 var(--accent);
  font-weight: 600;
}
.settings-main {
  flex: 1;
  min-width: 0;
}
@media (max-width: 900px) {
  .settings-layout {
    flex-direction: column;
  }
  .settings-toc {
    position: static;
    flex: none;
    flex-direction: row;
    flex-wrap: wrap;
    width: 100%;
  }
  .toc-filter {
    width: 100%;
  }
}
</style>
