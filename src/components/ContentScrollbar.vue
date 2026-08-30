<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const container = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const clientH = ref(0)
const scrollH = ref(0)

function measure() {
  const el = container.value
  if (!el) return
  scrollTop.value = el.scrollTop
  clientH.value = el.clientHeight
  scrollH.value = el.scrollHeight
}

let ro: ResizeObserver | null = null
function onWheel(e: WheelEvent) {
  if (!container.value) return
  container.value.scrollTop += e.deltaY
  e.preventDefault()
  measure()
}

onMounted(() => {
  container.value = document.querySelector('.content') as HTMLElement | null
  const inner = document.querySelector('.content-inner')
  measure()
  container.value?.addEventListener('scroll', measure, { passive: true })
  window.addEventListener('resize', measure)
  ro = new ResizeObserver(measure)
  if (container.value) ro.observe(container.value)
  if (inner) ro.observe(inner)
})

// 元素初始 v-if 为假，mount 时尚未渲染，故在出现后再绑定 wheel 监听
watch(barEl, (el) => {
  if (el) el.addEventListener('wheel', onWheel, { passive: false })
})

onUnmounted(() => {
  container.value?.removeEventListener('scroll', measure)
  window.removeEventListener('resize', measure)
  barEl.value?.removeEventListener('wheel', onWheel)
  ro?.disconnect()
})

const overflow = computed(() => scrollH.value > clientH.value + 1)
const thumbH = computed(() =>
  overflow.value ? Math.max(40, (clientH.value * clientH.value) / scrollH.value) : 0
)
const thumbTop = computed(() => {
  if (!overflow.value) return 0
  const maxScroll = scrollH.value - clientH.value
  if (maxScroll <= 0) return 0
  return (scrollTop.value / maxScroll) * (clientH.value - thumbH.value)
})

let dragging = false
let startY = 0
let startTop = 0
function onThumbDown(e: PointerEvent) {
  dragging = true
  startY = e.clientY
  startTop = scrollTop.value
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onThumbMove(e: PointerEvent) {
  if (!dragging || !container.value) return
  const maxScroll = scrollH.value - clientH.value
  const ratio = maxScroll / Math.max(1, clientH.value - thumbH.value)
  container.value.scrollTop = startTop + (e.clientY - startY) * ratio
}
function onThumbUp(e: PointerEvent) {
  dragging = false
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
}
function onTrackClick(e: MouseEvent) {
  if (!container.value) return
  const target = e.target as HTMLElement
  if (target.classList.contains('ct-thumb')) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = e.clientY - rect.top
  const maxScroll = scrollH.value - clientH.value
  container.value.scrollTop = ((y - thumbH.value / 2) / Math.max(1, clientH.value - thumbH.value)) * maxScroll
}
</script>

<template>
  <div
    v-if="overflow"
    ref="barEl"
    class="ct-scrollbar"
    @click="onTrackClick"
  >
    <div
      class="ct-thumb"
      :style="{ height: thumbH + 'px', transform: `translateY(${thumbTop}px)` }"
      @pointerdown="onThumbDown"
      @pointermove="onThumbMove"
      @pointerup="onThumbUp"
    ></div>
  </div>
</template>

<style scoped>
.ct-scrollbar {
  position: fixed;
  top: 32px;
  right: 0;
  bottom: 0;
  width: 12px;
  z-index: 850;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ct-scrollbar:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}
.ct-thumb {
  position: absolute;
  left: 3px;
  right: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 42%, transparent);
  transition: background 0.15s ease;
}
.ct-scrollbar:hover .ct-thumb,
.ct-thumb:hover {
  background: color-mix(in srgb, var(--text) 62%, transparent);
}
</style>
