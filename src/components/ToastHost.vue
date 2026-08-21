<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

const icons: Record<string, string> = {
  ok: 'M20 6 9 17l-5-5',
  err: 'M18 6 6 18M6 6l12 12',
  info: 'M12 8h.01M11 12h1v4h1'
}
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.kind}`" @click="dismiss(t.id)">
        <svg
          class="toast-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path v-if="icons[t.kind]" :d="icons[t.kind]" />
        </svg>
        <span class="toast-text">{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 20000; /* 高于所有悬浮窗（useModalZ 从 10000 起） */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(420px, 86vw);
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
.toast-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.toast--ok .toast-icon {
  color: var(--ok);
}
.toast--err {
  border-color: var(--err);
}
.toast--err .toast-icon {
  color: var(--err);
}
.toast--info .toast-icon {
  color: var(--accent-2);
}
.toast-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 进出场：底部上浮淡入 / 下沉淡出 */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.24s var(--ease-out), transform 0.24s var(--ease-out);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
/* 列表内部移动（上方 toast 被移除时下方平滑补位） */
.toast-move {
  transition: transform 0.24s var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition: none;
  }
}
</style>
