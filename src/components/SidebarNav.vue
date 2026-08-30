<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { useSidebar } from '@/composables/useSidebar'
import type { SyncEngineState } from '@shared/types'
import bangumiLogo from '@/assets/bangumi-logo.svg'

const route = useRoute()
const router = useRouter()
const { open: openSearch } = useSearchOverlay()
const { collapsed, toggleSidebar } = useSidebar()

// ===== 同步状态指示灯 =====
// 订阅主进程 syncEngine 状态（后台定时同步/手动同步共用一条链路）：
// running=旋转、ok=绿点(8s 后自动隐去)、error=红点常驻(悬停看原因，点击去设置页)
const syncState = ref<SyncEngineState | null>(null)
const syncMenuOpen = ref(false)
let okHideTimer: number | undefined
function onSync(s: SyncEngineState) {
  syncState.value = s
  if (okHideTimer) {
    clearTimeout(okHideTimer)
    okHideTimer = undefined
  }
  if (s.phase === 'ok') {
    okHideTimer = window.setTimeout(() => {
      if (syncState.value?.phase === 'ok') syncState.value = null
    }, 8000)
  }
}
onMounted(() => {
  window.acgn?.sync?.onStateChanged(onSync)
})
onUnmounted(() => {
  if (okHideTimer) clearTimeout(okHideTimer)
})
function syncTitle(): string {
  const s = syncState.value
  if (!s) return ''
  if (s.phase === 'running') {
    const label =
      s.kind === 'push' ? '正在上传' : s.kind === 'full' ? '正在全量拉取' : s.kind === 'pull' ? '正在拉取' : '正在双向同步'
    return `${label}…`
  }
  if (s.phase === 'error') return `同步失败：${s.error ?? ''}（点击前往设置）`
  const t = s.finishedAt ? new Date(s.finishedAt).toLocaleTimeString() : ''
  return `同步完成 ${t}`
}
function goSettings() {
  void router.push('/settings')
}
function openSettings() {
  syncMenuOpen.value = false
  goSettings()
}
// 快捷重试：直接复用同步 IPC（状态经 onSync 订阅自动刷新）；失败保留 error 态可再次重试
function retrySync(kind: 'push' | 'pull') {
  const fn = kind === 'push' ? window.acgn.sync.pushAll : window.acgn.sync.pullAll
  void fn().catch(() => {})
}

const items = [
  { to: '/', label: '主页', icon: 'M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9' },
  { to: '/anime', label: '动画', icon: 'M6 4 H18 a3 3 0 0 1 3 3 V17 a3 3 0 0 1 -3 3 H6 a3 3 0 0 1 -3 -3 V7 a3 3 0 0 1 3 -3 Z M10.5 8.5 l5 3.5 -5 3.5 Z' },
  { to: '/light-novel', label: '小说', icon: 'M3 5c3-1.5 7-1.5 9 0c2-1.5 6-1.5 9 0v13c-3-1.5-7-1.5-9 0c-2-1.5-6-1.5-9 0Z M12 5v13' },
  { to: '/manga', label: '漫画', icon: 'M3 19.5v-15A2.5 2.5 0 0 1 5.5 2H20a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5.5a1 1 0 0 1 0-5H21 M21 13.7 L18.9 11.6 A2 2 0 0 0 16.1 11.6 L10.7 17 M8.5 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z' },
  { to: '/galgame', label: '游戏', icon: 'M11.146 15.854a1.207 1.207 0 0 1 1.708 0l1.56 1.56A2 2 0 0 1 15 18.828V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2.172a2 2 0 0 1 .586-1.414z M18.828 15a2 2 0 0 1-1.414-.586l-1.56-1.56a1.207 1.207 0 0 1 0-1.708l1.56-1.56A2 2 0 0 1 18.828 9H21a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1z M6.586 14.414A2 2 0 0 1 5.172 15H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.172a2 2 0 0 1 1.414.586l1.56 1.56a1.207 1.207 0 0 1 0 1.708z M9 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.172a2 2 0 0 1-.586 1.414l-1.56 1.56a1.207 1.207 0 0 1-1.708 0l-1.56-1.56A2 2 0 0 1 9 5.172z' },
  { to: '/personal', label: '个人', icon: 'M8 21v-2a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
]
// 6 齿齿轮（描边风格）：以 (12,12) 为中心，齿根 r=6.5 / 齿顶 r=9，严格同心
const gearIcon = 'M 17.63 8.75 20.8 10.13 20.8 13.87 17.63 15.25 18.02 18.69 14.78 20.56 12.0 18.5 9.22 20.56 5.98 18.69 6.37 15.25 3.2 13.87 3.2 10.13 6.37 8.75 5.98 5.31 9.22 3.44 12.0 5.5 14.78 3.44 18.02 5.31 Z'

// 用响应式状态驱动动画类（Vue 重渲染不会冲掉），并用双重 rAF 强制重播
const isSpinning = ref(false)
// 按下反馈：按住时齿轮逆时针微调，松手即复位
const isPressed = ref(false)
function press() {
  isPressed.value = true
}
function release() {
  isPressed.value = false
}
function spinGear() {
  isPressed.value = false
  isSpinning.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      isSpinning.value = true
    })
  })
}
// 动画播完后移除 spinning 类，让 transform 回落到基础 rotate(30deg)
function onSpinEnd() {
  isSpinning.value = false
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="brand">
      <img :src="bangumiLogo" class="logo" alt="Bangumi" />
      <span class="brand-name">Bangumi</span>
      <button class="collapse-btn" type="button" :title="collapsed ? '展开边栏' : '收起边栏'" @click="toggleSidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <line x1="7.5" y1="7" x2="7.5" y2="17" />
        </svg>
      </button>
    </div>

    <!-- 全局搜索：展开态保留输入框外观（非真实 input，不可输入），点击整行在应用中央叠加搜索卡片 -->
    <div
      class="nav-search"
      role="button"
      tabindex="0"
      title="搜索作品 / 角色 / 人物（Ctrl+K）"
      @click="openSearch"
      @keyup.enter="openSearch"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <span class="ns-fake-input">搜索…</span>
      <span class="ns-kbd">Ctrl K</span>
    </div>

    <nav>
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :title="item.label"
        :class="{ 'router-link-active': route.path === item.to }"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path :d="item.icon" />
        </svg>
        <span class="nav-label">{{ item.label }}</span>
      </router-link>
    </nav>
    <div class="nav-spacer"></div>
    <!-- 同步状态指示灯：后台同步不再静默（running 旋转 / ok 绿点暂现 / error 红点常驻）。
         点击弹出快捷面板：状态摘要 + 一键重试上传/拉取 + 前往设置页 -->
    <div class="nav-sync-wrap">
      <div v-if="syncMenuOpen" class="sync-pop-backdrop" @click="syncMenuOpen = false"></div>
      <button
        v-if="syncState && syncState.phase !== 'idle'"
        type="button"
        class="nav-sync"
        :class="`nav-sync--${syncState.phase}`"
        :title="syncTitle()"
        aria-label="同步状态"
        @click.stop="syncMenuOpen = !syncMenuOpen"
      >
        <span v-if="syncState.phase === 'running'" class="ns-spinner"></span>
        <span v-else class="ns-dot"></span>
      </button>
      <div v-if="syncMenuOpen && syncState" class="sync-pop" @click.stop>
        <p class="sp-status" :class="{ err: syncState.phase === 'error' }">{{ syncTitle() }}</p>
        <button
          type="button"
          class="sp-btn"
          :disabled="syncState.phase === 'running'"
          @click="retrySync('push')"
        >重试上传</button>
        <button
          type="button"
          class="sp-btn"
          :disabled="syncState.phase === 'running'"
          @click="retrySync('pull')"
        >重试拉取</button>
        <button type="button" class="sp-btn sp-settings" @click="openSettings">打开设置页</button>
      </div>
    </div>
    <router-link
      to="/settings"
      class="nav-gear"
      title="设置"
        :class="{ 'router-link-active': route.path === '/settings' || route.path.startsWith('/settings/'), spinning: isSpinning, pressed: isPressed }"
      @mousedown="press"
      @mouseup="release"
      @mouseleave="release"
      @click="spinGear"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" @animationend="onSpinEnd">
        <circle cx="12" cy="12" r="3" />
        <path :d="gearIcon" />
      </svg>
      <span class="nav-label">设置</span>
    </router-link>
  </aside>
</template>

<style scoped>
/* 同步快捷面板：锚定指示灯上方，背板拦截外部点击 */
.nav-sync-wrap {
  position: relative;
}
.sync-pop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 29990;
}
.sync-pop {
  position: absolute;
  left: 14px;
  bottom: calc(100% + 8px);
  z-index: 29999;
  min-width: 168px;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sp-status {
  margin: 0 0 2px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.5;
  word-break: break-word;
}
.sp-status.err {
  color: var(--err);
}
.sp-btn {
  text-align: left;
  padding: 7px 10px;
  font-size: 13px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: background var(--dur-fast) ease;
}
.sp-btn:hover:not(:disabled) {
  background: var(--bg-elev);
}
.sp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.sp-settings {
  color: var(--text-dim);
  border-top: 1px solid var(--border-soft);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}
</style>
