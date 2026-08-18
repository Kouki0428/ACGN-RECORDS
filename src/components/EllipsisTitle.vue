<script setup lang="ts">
// 单行省略标题 + 悬停完整展示（tooltip）
// - 默认单行省略号截断（white-space:nowrap + ellipsis）；
// - 鼠标悬停时仅当文本**实际溢出**（scrollWidth > clientWidth）才显示 tooltip，
//   不溢出不打扰；tooltip 通过 Teleport 挂到 body + position:fixed，不参与布局，
//   opacity 淡入淡出（平滑过渡、无性能负担——仅在 hover 时检测/渲染）。
import { ref } from 'vue'

defineProps<{ text: string }>()

const el = ref<HTMLElement | null>(null)
const show = ref(false)
const pos = ref<{ left: number; top: number; maxWidth: number; above: boolean }>({
  left: 0,
  top: 0,
  maxWidth: 280,
  above: false,
})

let hideTimer = 0

function onEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = 0
  }
  const node = el.value
  if (!node) return
  // 仅当文本实际溢出时才展示 tooltip（避免无谓打扰）
  if (node.scrollWidth <= node.clientWidth + 1) return
  const r = node.getBoundingClientRect()
  const maxWidth = Math.min(320, Math.max(180, Math.round(r.width)))
  const left = Math.max(8, Math.min(r.left, window.innerWidth - maxWidth - 8))
  const spaceAbove = r.top
  pos.value = {
    left,
    // 默认显示在标题上方；上方空间不足 90px 时才翻到下方
    top: spaceAbove > 90 ? r.top - 6 : r.bottom + 6,
    maxWidth,
    above: spaceAbove > 90,
  }
  show.value = true
}

function onLeave() {
  if (hideTimer) clearTimeout(hideTimer)
  // 延迟隐藏，允许鼠标移到 tooltip 上继续阅读
  hideTimer = window.setTimeout(() => {
    show.value = false
  }, 100)
}
</script>

<template>
  <div ref="el" class="ellipsis-title" @mouseenter="onEnter" @mouseleave="onLeave">{{ text }}</div>
  <Teleport to="body">
    <Transition name="tip-fade">
      <div
        v-if="show"
        class="ellipsis-tip"
        :class="{ above: pos.above }"
        :style="{ left: pos.left + 'px', top: pos.top + 'px', maxWidth: pos.maxWidth + 'px' }"
        @mouseenter="onEnter"
        @mouseleave="onLeave"
      >
        {{ text }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ellipsis-title {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* tooltip：fixed + 高 z-index，不参与文档流、不影响布局 */
.ellipsis-tip {
  position: fixed;
  z-index: 12000;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.92);
  color: #fff;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  white-space: normal;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.ellipsis-tip.above {
  transform: translateY(-100%);
}
/* 平滑过渡：仅 opacity（合成器属性，GPU 合成） */
.tip-fade-enter-active,
.tip-fade-leave-active {
  transition: opacity 0.12s ease;
}
.tip-fade-enter-from,
.tip-fade-leave-to {
  opacity: 0;
}
</style>
