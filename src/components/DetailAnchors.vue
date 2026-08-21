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
  top: -26px; /* 抵消 .content 顶部内边距，吸附在滚动口最上沿 */
  z-index: 5; /* 压过详情封面横幅（同为 positioned，否则按树序被横幅盖住/参与其渐隐） */
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 2px;
  margin-bottom: 4px;
  /* 磨砂玻璃：低不透明度底 + 强模糊，让模糊封面的光晕透出来、随横幅一起「渐隐」 */
  background: color-mix(in srgb, var(--bg) 62%, transparent);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
}
.anchor-chip {
  padding: 4px 12px;
  font-size: 12.5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color var(--dur-fast) ease,
    border-color var(--dur-fast) ease,
    background var(--dur-fast) ease,
    transform 0.12s var(--ease-out);
}
.anchor-chip:hover {
  color: var(--text);
  background: var(--bg-elev);
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
</style>
