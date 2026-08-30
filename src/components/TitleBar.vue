<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useWindowChrome } from '../composables/useWindowChrome'
import { useSidebar } from '../composables/useSidebar'
import { useSettingsStore } from '@/stores/settings'

const { maximized, minimize, toggleMaximize, close } = useWindowChrome()
const { collapsed } = useSidebar()
const settings = useSettingsStore()

const root = ref<HTMLElement | null>(null)
function syncSidebarWidth() {
  root.value?.style.setProperty('--sidebar-w', collapsed.value ? '64px' : '210px')
}
onMounted(syncSidebarWidth)
watch(collapsed, syncSidebarWidth)

const isInactive = ref(false)
let offActive: (() => void) | null = null
onMounted(() => {
  offActive = window.acgn?.win?.onActiveChange?.((v: boolean) => { isInactive.value = !v }) ?? null
})
onBeforeUnmount(() => offActive?.())

type SnapZone = 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'maximize'
const snapZones: { key: SnapZone; label: string; rects: { x: number; y: number; w: number; h: number }[] }[] = [
  { key: 'left', label: '贴靠到左半屏', rects: [{ x: 1, y: 1, w: 7, h: 14 }] },
  { key: 'right', label: '贴靠到右半屏', rects: [{ x: 8, y: 1, w: 7, h: 14 }] },
  { key: 'top-left', label: '贴靠到左上角', rects: [{ x: 1, y: 1, w: 7, h: 7 }] },
  { key: 'top-right', label: '贴靠到右上角', rects: [{ x: 8, y: 1, w: 7, h: 7 }] },
  { key: 'bottom-left', label: '贴靠到左下角', rects: [{ x: 1, y: 8, w: 7, h: 7 }] },
  { key: 'bottom-right', label: '贴靠到右下角', rects: [{ x: 8, y: 8, w: 7, h: 7 }] },
  { key: 'maximize', label: '最大化', rects: [{ x: 1, y: 1, w: 14, h: 14 }] }
]

const showSnap = ref(false)
let openTimer: number | undefined
let closeTimer: number | undefined

function clearTimers() {
  if (openTimer) { clearTimeout(openTimer); openTimer = undefined }
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = undefined }
}
function onMaxEnter() {
  clearTimers()
  openTimer = window.setTimeout(() => { showSnap.value = true }, 800)
}
function scheduleClose() {
  clearTimers()
  closeTimer = window.setTimeout(() => { showSnap.value = false }, 220)
}
function onFlyEnter() { clearTimers() }

function onMaxClick() {
  // 单击最大化按钮：直接最大化 / 还原（标准行为）；贴靠分区走悬停浮层
  toggleMaximize()
}
function doSnap(zone: SnapZone) {
  showSnap.value = false
  clearTimers()
  window.acgn?.win?.snap(zone)
}

function onDocPointerDown(e: PointerEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) showSnap.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  clearTimers()
})
</script>

<template>
  <div class="title-bar" :class="{ 'is-inactive': isInactive }" ref="root">
    <div class="title-bar__hit" @dblclick="toggleMaximize" aria-hidden="true"></div>

    <div class="title-bar__buttons">
      <button class="tb-btn" type="button" title="最小化" aria-label="最小化" @click="minimize">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="3" y="7.5" width="10" height="1.4" rx="0.7" fill="currentColor" />
        </svg>
      </button>

      <div class="tb-max-wrap" @mouseenter="onMaxEnter" @mouseleave="scheduleClose">
        <button class="tb-btn" type="button"
                :title="maximized ? '向下还原' : '最大化'" aria-label="最大化"
                @click="onMaxClick">
          <svg v-if="!maximized" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="4" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
            <rect x="5" y="5" width="7" height="7" rx="1" fill="rgba(0,0,0,0.35)" stroke="currentColor" stroke-width="1.3" />
          </svg>
        </button>

        <transition name="snap-fly">
          <div v-if="showSnap" class="snap-flyout" :class="{ glass: settings.immersiveGlow }"
               @mouseenter="onFlyEnter" @mouseleave="scheduleClose">
            <button v-for="z in snapZones" :key="z.key" class="snap-opt" type="button"
                    :title="z.label" @click="doSnap(z.key)">
              <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" class="snap-ico">
                <rect x="0.5" y="0.5" width="15" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5" />
                <rect v-for="(r, i) in z.rects" :key="i"
                      :x="r.x" :y="r.y" :width="r.w" :height="r.h" rx="1.2"
                      fill="currentColor" opacity="0.9" />
              </svg>
              <span class="snap-label">{{ z.label }}</span>
            </button>
          </div>
        </transition>
      </div>

      <button class="tb-btn tb-btn--close" type="button" title="关闭" aria-label="关闭" @click="close">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3.6 3.6 L12.4 12.4 M12.4 3.6 L3.6 12.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  /* 高于内容级悬浮（讨论抽屉 z-55 等），保证窗口控制与贴靠浮层始终在其之上；
     但低于真正的模态层（设置/收藏等 z-900+），模态遮罩仍会整体盖住标题栏。 */
  z-index: 80;
  display: flex;
  align-items: center;
  pointer-events: none; /* 仅让 .title-bar__hit 与 .title-bar__buttons 接收事件，侧栏顶部控件可穿透点击 */
}
.title-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(130% 170% at 50% -65%, rgba(255, 255, 255, 0.10), transparent 55%);
  pointer-events: none;
}

/* 拖拽区：覆盖「侧栏右缘 → 按钮左缘」之间的整条顶栏；侧栏顶部自身已是可拖拽，无需覆盖 */
.title-bar__hit {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--sidebar-w, 210px);
  right: 120px;
  -webkit-app-region: drag;
  pointer-events: auto;
}

.title-bar__buttons {
  position: absolute;
  top: 0;
  right: 0;
  height: 32px;
  display: flex;
  align-items: stretch;
  pointer-events: auto;
}

.tb-btn {
  width: 40px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease;
  padding: 0;
}
/* 浅色模式下 --bg-elev-hover 与渐变底色几乎同色、看不出来；改用主题强调色淡染，
   暗/亮主题都明显可见，且与抽屉手柄等强调色语言一致。 */
.tb-btn:hover {
  background: rgba(47, 111, 176, 0.16);
  background: color-mix(in srgb, var(--accent, #2f6fb0) 20%, var(--bg-elev, #eef1f6));
}
.tb-btn:active {
  background: rgba(47, 111, 176, 0.28);
  background: color-mix(in srgb, var(--accent, #2f6fb0) 32%, var(--bg-elev, #eef1f6));
}
.tb-btn--close:hover { background: #e81123; color: #fff; }
.tb-btn--close:active { background: #c40e1f; }

.tb-max-wrap {
  position: relative;
  display: flex;
}

.snap-flyout {
  position: absolute;
  top: 32px;
  right: 0;
  width: 188px;
  padding: 6px;
  background: var(--bg-elev, #1c1f26);
  border: 1px solid var(--border-soft, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 60;
  overflow: hidden;
}
/* ——「沉浸光感」开启时的液态玻璃（设置可关，与讨论抽屉 / 悬浮卡同一设计语言）——
   折射由全局 SVG 滤镜 liquid-glass-distortion 完成（feDisplacementMap 扰动背板像素 → 水波扭曲）
   再叠加模糊；面板本体叠自上而下微透光 + 顶部内描边高光，与讨论抽屉同款光感。 */
.snap-flyout.glass {
  isolation: isolate;
  overflow: hidden;
  border-color: transparent;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(255, 255, 255, 0.025) 42%,
      rgba(255, 255, 255, 0) 100%
    ),
    color-mix(in srgb, var(--bg-panel) 72%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 8px 28px rgba(0, 0, 0, 0.5);
}
.snap-flyout.glass::before {
  content: '';
  position: absolute;
  inset: -8px;
  z-index: -1;
  border-radius: var(--radius);
  backdrop-filter: url(#liquid-glass-distortion) saturate(1.5) blur(6px);
  -webkit-backdrop-filter: url(#liquid-glass-distortion) saturate(1.5) blur(6px);
}
/* 入场只动 top、不动 opacity / transform：opacity<1 或 transform 过渡期间元素会变成
   backdrop root，导致 ::before 的 backdrop-filter 采样失效（玻璃要在动画结束后才出现、
   表现为「弹出后才突然跳成沉浸光感」）。改为位移动画，玻璃全程可见，与讨论抽屉同款处理。 */
.snap-fly-enter-active,
.snap-fly-leave-active {
  transition: top 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.snap-fly-enter-from,
.snap-fly-leave-to {
  top: 24px;
}
.snap-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: none;
  background: transparent;
  color: var(--text, #e6e6e6);
  border-radius: var(--radius-sm);
  cursor: default;
  text-align: left;
  font-size: 13px;
}
.snap-opt:hover {
  background: var(--accent, #2f6fb0);
  color: #fff;
  box-shadow: 0 4px 20px -2px var(--accent-glow, rgba(47, 111, 176, 0.9));
}
.snap-ico { flex-shrink: 0; color: var(--text, #e6e6e6); }
.snap-opt:hover .snap-ico { color: #fff; }

/* 失焦时仅让控件变暗（Edge / opencode 式精致感）；
   注意：不能给整条 .title-bar 设 opacity，否则打开的贴靠浮层会随之半透明。 */
.title-bar.is-inactive .title-bar__hit { opacity: 0.55; }
.title-bar.is-inactive .tb-btn { opacity: 0.55; }
.title-bar.is-inactive::before { opacity: 0.5; }
</style>
