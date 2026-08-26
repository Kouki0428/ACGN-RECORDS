<script setup lang="ts">
// 详情页吸顶锚点条：点击平滑跳转到对应区块（[data-anchor]），滚动时高亮当前区。
// 纯渲染层通用组件，四个详情视图共用；依赖全局 [data-anchor] 的 scroll-margin-top。
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'

export interface AnchorItem {
  key: string
  label: string
}

const props = defineProps<{ items: AnchorItem[] }>()

const settings = useSettingsStore()

const activeKey = ref('')
// 仅展示「目标元素真实存在」的锚点：动画/游戏没有单行本区块（SubjectRelations
// 空数据不渲染根节点），按存在性过滤后对应 chip 自动隐藏，无需各视图硬编码。
const shownItems = ref<AnchorItem[]>([])
let scroller: HTMLElement | null = null
let raf = 0

function refreshShown() {
  shownItems.value = props.items.filter(
    (it) => !!document.querySelector(`[data-anchor="${it.key}"]`)
  )
}

function querySections(): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const it of shownItems.value) {
    const el = document.querySelector<HTMLElement>(`[data-anchor="${it.key}"]`)
    if (el) out.push(el)
  }
  return out
}

function updateActive() {
  const sections = querySections()
  if (!sections.length) return
  // 以「吸顶栏下沿」为判定线：最后一个越线的区块即当前区
  const line = (scroller?.getBoundingClientRect().top ?? 0) + 96
  let cur = sections[0]
  for (const el of sections) {
    if (el.getBoundingClientRect().top <= line) cur = el
  }
  activeKey.value = cur.getAttribute('data-anchor') ?? ''
}

function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    updateActive()
  })
}

function jump(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${key}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 液态玻璃的「沉浸光感」：悬停滑动时主题色光斑跟随鼠标（记录指针在按钮内的坐标，
// 经 CSS 变量 --mx/--my 驱动 ::after 径向渐变的位置；进入/离开用类切换淡入淡出）
function onChipMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}
function onChipEnter(e: MouseEvent) {
  ;(e.currentTarget as HTMLElement).classList.add('chip-glow')
}
function onChipLeave(e: MouseEvent) {
  ;(e.currentTarget as HTMLElement).classList.remove('chip-glow')
}

onMounted(async () => {
  scroller = document.querySelector('.content')
  scroller?.addEventListener('scroll', onScroll, { passive: true })
  await nextTick()
  refreshShown()
  updateActive()
  // 部分区块由异步数据驱动渲染（如角色/关联补全后才有根节点），延迟复查一次
  window.setTimeout(() => {
    refreshShown()
    updateActive()
  }, 600)
})
onUnmounted(() => {
  scroller?.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.items,
  async () => {
    await nextTick()
    refreshShown()
    updateActive()
  },
  { deep: true }
)
</script>

<template>
  <div class="anchor-bar" :class="{ glass: settings.immersiveGlow }">
    <button
      v-for="it in shownItems"
      :key="it.key"
      type="button"
      class="anchor-chip"
      :class="{ active: activeKey === it.key }"
      @click="jump(it.key)"
      @mousemove="onChipMove"
      @mouseenter="onChipEnter"
      @mouseleave="onChipLeave"
    >
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.anchor-bar {
  position: sticky;
  /* Chromium 的 sticky 相对「滚动容器内边距盒」定位：.content 顶部有 26px 内边距，
     用 -28px 抵消并微调（用户校准），使条体精确贴住窗口最顶沿。 */
  top: -28px;
  z-index: 5; /* 压过详情封面横幅（同为 positioned，否则按树序被横幅盖住/参与其渐隐） */
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  /* 左右顶满窗口：抵消 .content(左 30px) 与 .content-inner(右 30px) 的内边距 */
  margin-inline: -30px;
  /* 内容缩进保持与页面正文对齐（30px 外边距补偿 + 原 2px + 10px 呼吸位） */
  padding: 8px 42px;
  margin-bottom: 4px;
}
.anchor-chip {
  position: relative;
  padding: 4px 12px;
  font-size: 12.5px;
  border-radius: 999px;
  /* 关闭「沉浸光感」时的回退样式：普通高斯模糊按钮（磨砂） */
  border-color: transparent;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color var(--dur-fast) ease,
    border-color var(--dur-fast) ease,
    background var(--dur-fast) ease,
    box-shadow var(--dur-fast) ease,
    transform 0.12s var(--ease-out);
}
.anchor-chip:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 72%, transparent);
}
.anchor-chip:active {
  transform: scale(0.95);
}
.anchor-chip.active {
  color: #fff;
  background: var(--accent-grad);
  border-color: transparent;
  font-weight: 600;
}

/* ——以下为「沉浸光感」开启时的液态玻璃覆盖（设置可关）—— */
.anchor-bar.glass .anchor-chip {
  /* 沉浸式液态玻璃：折射由全局 SVG 滤镜 liquid-glass-distortion 完成
     （feDisplacementMap 扰动背板像素 → 水波扭曲），叠加轻微模糊与提饱和。
     backdrop-filter 放在外扩 8px 的 ::before 上并被 overflow 裁掉：
     位移滤镜会把边缘像素拉出拉伸线，外扩裁剪保证按钮四周干净。 */
  isolation: isolate;
  overflow: hidden;
  border-color: transparent;
  background: color-mix(in srgb, #fff 7%, transparent);
}
.anchor-bar.glass .anchor-chip::before {
  content: '';
  position: absolute;
  inset: -8px;
  z-index: -1;
  border-radius: 999px;
  backdrop-filter: url(#liquid-glass-distortion) blur(2px) saturate(1.5);
  -webkit-backdrop-filter: url(#liquid-glass-distortion) blur(2px) saturate(1.5);
}
.anchor-bar.glass .anchor-chip:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, #fff 13%, transparent);
}
.anchor-bar.glass .anchor-chip.active {
  border-color: transparent;
  /* 必须在此处重申品牌渐变：上面的玻璃底规则特异性更高，
     会覆盖低特异性的 .anchor-chip.active 背景 → 激活态不变色 */
  background: var(--accent-grad);
  box-shadow: 0 4px 18px color-mix(in srgb, #ff5c8a 40%, transparent);
}
/* 鼠标跟随的主题色光斑：径向渐变锚定在指针坐标（--mx/--my 由 JS 写入），
   悬停时淡入、滑出时淡出；纯装饰层不拦截点击 */
.anchor-bar.glass .anchor-chip::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    60px circle at var(--mx, 50%) var(--my, 50%),
    color-mix(in srgb, var(--accent) 42%, transparent),
    transparent 68%
  );
  opacity: 0;
  transition: opacity 0.28s ease;
  pointer-events: none;
}
.anchor-bar.glass .anchor-chip.chip-glow::after {
  opacity: 1;
}
</style>
