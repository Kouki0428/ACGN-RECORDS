<script setup lang="ts">
// 空状态占位：图标 + 主文案 + 可选副文案 + 操作按钮插槽（如「去搜索添加」）
defineProps<{
  text: string
  hint?: string
}>()
</script>

<template>
  <div class="empty-state">
    <div class="es-art">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M3 15l4.5-4.5a1.4 1.4 0 0 1 2 0L14 15" />
        <circle cx="15" cy="9" r="1.6" />
        <path d="M13 13l2-2a1.4 1.4 0 0 1 2 0l4 4" />
      </svg>
    </div>
    <p class="es-text">{{ text }}</p>
    <p v-if="hint" class="es-hint">{{ hint }}</p>
    <div class="es-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 56px 24px;
  text-align: center;
}
.es-art {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  display: grid;
  place-items: center;
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
  margin-bottom: 8px;
  opacity: 0.9;
}
.es-art svg {
  width: 30px;
  height: 30px;
}
.es-text {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.es-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-dim);
}
.es-actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}
</style>
