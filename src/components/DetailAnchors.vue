<script setup lang="ts">
// 详情页吸顶锚点条：点击平滑跳转到对应区块（[data-anchor]），滚动时高亮当前区。
// 纯渲染层通用组件，四个详情视图共用；依赖全局 [data-anchor] 的 scroll-margin-top。
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

export interface AnchorItem {
  key: string
  label: string
}

const props = defineProps<{ items: AnchorItem[] }>()

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
  <div class="anchor-bar">
    <button
      v-for="it in shownItems"
      :key="it.key"
      type="button"
      class="anchor-chip"
      :class="{ active: activeKey === it.key }"
      @click="jump(it.key)"
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
  padding: 4px 12px;
  font-size: 12.5px;
  border-radius: 999px;
  /* 液态玻璃：顶部微亮→底部的半透明渐变层，配合背板模糊+饱和提升产生「透镜」质感 */
  border: 1px solid color-mix(in srgb, #fff 16%, transparent);
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, #fff 11%, transparent),
    color-mix(in srgb, #fff 3%, transparent)
  );
  backdrop-filter: blur(14px) saturate(1.7);
  -webkit-backdrop-filter: blur(14px) saturate(1.7);
  /* 玻璃高光：顶缘内亮线 + 底缘内暗线塑体积，外投柔影悬浮 */
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 24%, transparent),
    inset 0 -1px 0 color-mix(in srgb, #000 14%, transparent),
    0 2px 8px color-mix(in srgb, #000 20%, transparent);
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
  transform: translateY(-1px);
  border-color: color-mix(in srgb, #fff 28%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 32%, transparent),
    inset 0 -1px 0 color-mix(in srgb, #000 12%, transparent),
    0 4px 12px color-mix(in srgb, #000 26%, transparent);
}
.anchor-chip:active {
  transform: scale(0.95);
}
.anchor-chip.active {
  color: #fff;
  background: var(--accent-grad);
  border-color: transparent;
  font-weight: 600;
  /* 选中态保留玻璃质感：白色顶缘高光 + 品牌色柔影 */
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 30%, transparent),
    0 2px 10px color-mix(in srgb, #ff5c8a 38%, transparent);
}
</style>
