<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  page: number
  totalPages: number
}>()

const emit = defineEmits<{ (e: 'update:page', p: number): void }>()

// 页码序列：首页/末页恒显 + 当前页±1，间隙用省略号；总页数少则全列
const items = computed<(number | 'l')[]>(() => {
  const t = props.totalPages
  const c = props.page
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const out: (number | 'l')[] = [1]
  const s = Math.max(2, c - 1)
  const e = Math.min(t - 1, c + 1)
  if (s > 2) out.push('l')
  for (let i = s; i <= e; i++) out.push(i)
  if (e < t - 1) out.push('l')
  out.push(t)
  return out
})

function go(p: number) {
  const clamped = Math.min(Math.max(1, p), props.totalPages)
  if (clamped !== props.page) emit('update:page', clamped)
}
</script>

<template>
  <nav class="pager" aria-label="分页">
    <button class="pg-btn" type="button" :disabled="page <= 1" aria-label="上一页" @click="go(page - 1)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
    <template v-for="(it, i) in items" :key="`${it}-${i}`">
      <span v-if="it === 'l'" class="pg-dots">…</span>
      <button
        v-else
        class="pg-btn pg-num"
        type="button"
        :class="{ active: it === page }"
        :aria-current="it === page ? 'page' : undefined"
        @click="go(it)"
      >{{ it }}</button>
    </template>
    <button class="pg-btn" type="button" :disabled="page >= totalPages" aria-label="下一页" @click="go(page + 1)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
    </button>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin: 18px 0 6px;
}
.pg-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.pg-btn:hover:not(:disabled):not(.active) {
  color: var(--text);
  border-color: var(--border);
}
.pg-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.pg-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.pg-dots {
  color: var(--text-dim);
  font-size: 13px;
  padding: 0 2px;
  user-select: none;
}
</style>
