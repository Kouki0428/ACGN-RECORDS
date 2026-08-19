<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useEntityCard } from '@/composables/useEntityCard'
import { useModalZ } from '@/composables/useModalZ'
import EntityCard from '@/components/EntityCard.vue'
import SubjectCard from '@/components/SubjectCard.vue'
import EpisodeCommentModal from '@/components/EpisodeCommentModal.vue'
import TagWorksCard from '@/components/TagWorksCard.vue'

// 实体/作品卡片共用同一导航栈（useEntityCard），原本拆成 EntityCard（角色/CV）与
// SubjectCard（作品）两个独立 overlay——跨 kind 跳转时旧 overlay 卸载、新 overlay 挂载，
// 触发完整的进入/离开动画，看起来「整个重新加载」。
// 这里合并为「单一 overlay 容器」：overlay 本身只在 isOpen 时挂载/卸载，
// 内部按 state.kind 切换 body（EntityCard / SubjectCard）。这样在同一条导航栈里
// 角色↔CV↔作品 互跳时，外层 overlay 始终不卸载，只换内容 → 局部刷新、无重载闪烁。
// 从搜索悬浮窗点结果唤起时 instantOpen=true，禁用进入过渡（卡片瞬间出现、遮罩连续）。
const { isOpen, state, close, instantOpen } = useEntityCard()
const z = useModalZ(isOpen)

// 单一 overlay 容器内按 state.kind 挂载对应 body；用 KeepAlive 按 kind 缓存每个 body 实例，
// 使 角色↔CV↔作品↔标签 互跳 / 返回时不卸载重建 → 不重新发请求、不丢失滚动位置与已加载内容，
// 平滑「局部换内容」而非「整屏重载闪烁」。以 kind 为缓存 key：同 kind 内换数据（如作品→关联作品）
// 仍由各组件内部 watch(id/tag) 重新加载，不受影响。
const bodyComp = computed(() => {
  const k = state.value?.kind
  if (k === 'subject') return SubjectCard
  if (k === 'episode') return EpisodeCommentModal
  if (k === 'tag') return TagWorksCard
  return EntityCard
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) close()
}
watch(
  isOpen,
  (v) => {
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true }
)
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="overlay" :disabled="instantOpen">
    <div v-if="isOpen" class="esc-overlay" :style="{ zIndex: z }" @click="close">
      <!-- 单一 overlay 容器内按 state.kind 切换 body：
           角色/CV(/null) → EntityCard；作品 → SubjectCard；单集评论 → EpisodeCommentModal。
           在同一条导航栈里 角色↔CV↔作品↔单集评论 互跳时，外层 overlay 始终不卸载，
           只换内部内容 → 局部刷新、无重载闪烁。 -->
      <!-- 内部 body 切换：KeepAlive 缓存实例（返回不重载、不重新发请求、不丢失滚动位置）；
           kind 变化即时换内容（无切换动画），配合统一后的面板尺寸，标签↔作品↔角色 互跳时
           尺寸/位置完全一致，呈现「原地换内容」而非「整屏滑入重载」。 -->
      <KeepAlive>
        <div class="swap-panel" :key="state?.kind">
          <component :is="bodyComp" />
        </div>
      </KeepAlive>
    </div>
  </Transition>
</template>

<style scoped>
/* 单一遮罩容器：位置/模糊/层级与原来的 entity-overlay / subject-overlay 一致 */
.esc-overlay {
  position: fixed;
  inset: 0;
  /* 暗化 + 模糊由全局唯一 .modal-backdrop 统一负责，这里只做透明点击层，避免切换时闪烁 */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}
/* 进入/离开：遮罩淡入淡出 + 卡片轻微上浮（作用于内部 .entity-card / .subject-card，
   用 :deep 穿透到子组件面板，因为过渡类在宿主 overlay 上、面板在子组件内） */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s ease;
}
.overlay-enter-active :deep(.entity-card),
.overlay-enter-active :deep(.subject-card),
.overlay-enter-active :deep(.ec-modal),
.overlay-enter-active :deep(.tag-works-card),
.overlay-leave-active :deep(.entity-card),
.overlay-leave-active :deep(.subject-card),
.overlay-leave-active :deep(.ec-modal),
.overlay-leave-active :deep(.tag-works-card) {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.overlay-enter-from :deep(.entity-card),
.overlay-enter-from :deep(.subject-card),
.overlay-enter-from :deep(.ec-modal),
.overlay-enter-from :deep(.tag-works-card),
.overlay-leave-to :deep(.entity-card),
.overlay-leave-to :deep(.subject-card),
.overlay-leave-to :deep(.ec-modal),
.overlay-leave-to :deep(.tag-works-card) {
  transform: translateY(-14px) scale(0.98);
  opacity: 0;
}
/* 内部 body 切换面板：唯一负责宽/居中/限宽的容器（卡片根已改为 width:100% 填满本面板）。
   绝对定位 + top:12vh 与遮罩层顶距一致；left/right/margin 居中（非 transform），
   避免被任何过渡 transform 覆盖导致横向跳动。 */
.swap-panel {
  position: absolute;
  top: 8vh;
  left: 0;
  right: 0;
  margin-inline: auto;
  width: calc(100% - 64px);
  max-width: 1000px;
  /* 统一高度上限：与单集评论(.ec-modal)/搜索(.search-card)一致，均为 calc(100vh - 16vh)=84vh。
     配合 top:8vh → 上下各留 8vh，对称。内部 body 自身已 max-height:80vh + 内部滚动，
     此处作为容器层兜底，确保任何新 body 也不会超出视口。 */
  max-height: calc(100vh - 16vh);
}
</style>
