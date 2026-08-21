<script setup lang="ts">
// 全局右键菜单渲染层：定位钳制到视口内；点击任意处 / Esc / 滚动 关闭。
import { nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { useContextMenu } from '@/composables/useContextMenu'

const { state, close, run } = useContextMenu()
const el = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })

watch(
  () => state.value.visible,
  async (v) => {
    if (!v) return
    await nextTick()
    const m = el.value
    if (!m) return
    const w = m.offsetWidth
    const h = m.offsetHeight
    pos.value = {
      x: Math.max(8, Math.min(state.value.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(state.value.y, window.innerHeight - h - 8))
    }
    window.addEventListener('resize', close, { once: true })
    window.addEventListener('wheel', close, { once: true, passive: true })
  }
)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && state.value.visible) close()
}
function onDocClick() {
  // 菜单内部点击由 @click.stop 处理，这里兜底关闭
  close()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onDocClick, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onDocClick, true)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx">
      <div
        v-if="state.visible"
        ref="el"
        class="ctx-menu"
        role="menu"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <template v-for="(it, i) in state.items" :key="it.key">
          <div v-if="it.separatorBefore && i > 0" class="ctx-sep"></div>
          <button
            type="button"
            class="ctx-item"
            :class="{ danger: it.danger, disabled: it.disabled }"
            role="menuitem"
            :disabled="it.disabled"
            @click="run(it)"
          >
            <span class="ctx-check" :class="{ on: it.checked }">
              <svg v-if="it.checked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span class="ctx-label">{{ it.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 30000; /* 高于所有悬浮窗与 Toast */
  min-width: 168px;
  max-width: 260px;
  padding: 5px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  user-select: none;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 7px 9px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) ease;
}
.ctx-item:hover:not(.disabled) {
  background: var(--bg-elev);
}
.ctx-item:active:not(.disabled) {
  transform: scale(0.985);
}
.ctx-item.danger {
  color: var(--err);
}
.ctx-item.disabled {
  opacity: 0.45;
  cursor: default;
}
/* 勾选占位：固定宽度保证文字左对齐 */
.ctx-check {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ctx-check svg {
  width: 12px;
  height: 12px;
  color: var(--accent-2);
}
.ctx-check.on {
  color: var(--accent-2);
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-soft);
}

.ctx-enter-active,
.ctx-leave-active {
  transition: opacity 0.12s ease, transform 0.12s var(--ease-out);
}
.ctx-enter-from,
.ctx-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-3px);
}
@media (prefers-reduced-motion: reduce) {
  .ctx-enter-active,
  .ctx-leave-active {
    transition: none;
  }
}
</style>
