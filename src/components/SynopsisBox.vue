<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'

const props = defineProps<{
  /** 作品简介文本 */
  text: string
  /**
   * 折叠后的最大高度（px）。不传则自动按「封面下端」计算：
   * 封面高度 - 简介上端到封面顶端的距离 - 右栏下内边距。
   * 仅在作品详情页 / 悬浮窗（结构为 .detail__main > .detail__poster + .detail__body）下生效。
   */
  maxCollapsedPx?: number
}>()

const rootRef = ref<HTMLElement | null>(null)
const expanded = ref(false)
const overflowing = ref(false)
const maxH = ref<number | undefined>(undefined)
const dur = ref(0.32) // 过渡时长（秒），按高度差自适应，保证长短简介观感一致

// 收起且确实溢出时，才对文字应用由实变虚的遮罩
const clamped = computed(() => overflowing.value && !expanded.value)

function measure() {
  const root = rootRef.value
  if (!root) return
  const textEl = root.querySelector('.syn-text') as HTMLElement | null
  if (!textEl) return

  // scrollHeight 始终反映完整内容高度，不受 max-height 裁剪影响，
  // 因此无需临时解除 max-height —— 避免手动改 style 打断 max-height 过渡动画。
  const fullH = textEl.scrollHeight

  // 计算可用高度：默认按封面下端，否则用传入的固定值
  let avail = props.maxCollapsedPx ?? 0
  if (!props.maxCollapsedPx) {
    const main = root.closest('.detail__main') as HTMLElement | null
    const poster = main?.querySelector('.detail__poster') as HTMLElement | null
    const body = main?.querySelector('.detail__body') as HTMLElement | null
    if (poster) {
      const mainRect = main!.getBoundingClientRect()
      const posterRect = poster.getBoundingClientRect()
      const textRect = textEl.getBoundingClientRect()
      const hintTopRel = textRect.top - mainRect.top
      const padBottom = body ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 0
      avail = posterRect.height - hintTopRel - padBottom
    }
  }

  if (avail > 0 && fullH > avail + 4) {
    overflowing.value = true
    // 展开时用完整自然高度作为 max-height（= 真实内容高度，无 overshoot），收起时截到封面下端
    maxH.value = expanded.value ? Math.ceil(fullH) : Math.max(Math.round(avail), 44)
    // 按高度差自适应时长：短变化短、长变化长，避免长简介「一闪而过」看不出动画
    const delta = Math.max(0, Math.ceil(fullH) - Math.round(avail))
    dur.value = Math.min(0.6, Math.max(0.28, delta / 1400))
  } else {
    overflowing.value = false
    maxH.value = undefined
  }
}

let ro: ResizeObserver | null = null
onMounted(async () => {
  await nextTick()
  measure()
  ro = new ResizeObserver(() => measure())
  if (rootRef.value) ro.observe(rootRef.value)
  const main = rootRef.value?.closest('.detail__main') as HTMLElement | null
  const poster = main?.querySelector('.detail__poster') as HTMLElement | null
  if (poster && ro) ro.observe(poster)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

watch(
  () => [props.text, props.maxCollapsedPx],
  async () => {
    await nextTick()
    measure()
  }
)

// 展开/收起切换时重新计算（收起恢复截断 + 遮罩，展开解除 + 完整显示）
watch(expanded, async () => {
  await nextTick()
  measure()
})
</script>

<template>
  <div ref="rootRef" class="syn-box">
    <p
      class="hint syn-text"
      :class="{ 'is-masked': clamped }"
      :style="maxH != null ? { maxHeight: maxH + 'px', '--syn-dur': dur.toFixed(2) + 's' } : undefined"
    >{{ text }}</p>
    <button
      v-if="overflowing"
      class="syn-toggle"
      type="button"
      :title="expanded ? '收起简介' : '展开完整简介'"
      @click="expanded = !expanded"
    >{{ expanded ? '收起' : '展开' }}</button>
  </div>
</template>

<style scoped>
.syn-box {
  position: relative;
  display: flex;
  flex-direction: column;
}
.syn-text {
  margin: 8px 0 0;
  overflow: hidden;
  word-break: break-word;
  transition: max-height var(--syn-dur, 0.32s) cubic-bezier(0.4, 0, 0.2, 1);
}
/* 收起遮罩：让文字自身由实变虚（mask 渐隐），与背景无关 ——
   详情页与悬浮窗（背景不同）均正确，不再出现「浅→深」的色带。 */
.syn-text.is-masked {
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
}
/* 展开按钮：隐蔽的纯文字链接样式（无边框 / 无底色），置于文字下方右对齐，避免压住正文 */
.syn-toggle {
  align-self: flex-end;
  margin: 3px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  text-decoration: none;
  cursor: pointer;
}
.syn-toggle:hover {
  color: var(--accent-2);
  text-decoration: underline;
}
</style>
