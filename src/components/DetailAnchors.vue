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
let scroller: HTMLElement | null = null
let raf = 0

function querySections(): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const it of props.items) {
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
  updateActive()
})
onUnmounted(() => {
  scroller?.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.items,
  async () => {
    await nextTick()
    updateActive()
  },
  { deep: true }
)
</script>

<template>
  <div class="anchor-bar">
    <button
      v-for="it in items"
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
  z-index: 50;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 2px;
  margin-bottom: 4px;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
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
