<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Category } from '@shared/types'
import { statusTabs } from '@/utils/statusLabels'
import { dbClient } from '@/services/dbClient'
import { useCollectionModal } from '@/composables/useCollectionModal'

const props = defineProps<{
  category: Category
  modelValue: number
}>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const tabs = computed(() => statusTabs(props.category))
// 各状态条目数：{ status: count }
const counts = ref<Record<number, number>>({})
// 仅展示有条目的状态；但当前选中的标签即使为 0 也保留（避免无法切回）
const visibleTabs = computed(() =>
  tabs.value.filter((t) => (counts.value[t.status] || 0) > 0 || t.status === props.modelValue)
)
const { refreshTick } = useCollectionModal()

// 按当前分类统计各收藏状态的条目数
async function loadCounts() {
  try {
    const rows = await dbClient.query<{ status: number; cnt: number }>(
      `SELECT c.status AS status, COUNT(*) AS cnt
       FROM collections c JOIN subjects s ON s.id = c.subject_id
       WHERE s.category = ?
       GROUP BY c.status`,
      [props.category]
    )
    const map: Record<number, number> = {}
    for (const r of rows) map[r.status] = r.cnt
    counts.value = map
  } catch {
    counts.value = {}
  }
}

function select(status: number) {
  emit('update:modelValue', status)
}

onMounted(loadCounts)
// 切换分类 / 收藏增删后刷新计数
watch(() => props.category, loadCounts)
watch(refreshTick, loadCounts)
</script>

<template>
  <div class="status-tabs">
    <button
      v-for="t in visibleTabs"
      :key="t.status"
      type="button"
      class="status-tab"
      :class="{ active: t.status === modelValue }"
      @click="select(t.status)"
    >
      {{ t.label }}<span class="count">{{ counts[t.status] || 0 }}</span>
    </button>
  </div>
</template>

<style scoped>
.status-tabs {
  display: flex;
  gap: 8px;
  margin: 4px 0 12px;
  flex-wrap: wrap;
}
.status-tab {
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid var(--border, #2a3342);
  background: transparent;
  color: var(--text-dim, #8b94a3);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.status-tab:hover {
  color: var(--text, #e6e9ef);
  border-color: var(--text-dim, #8b94a3);
}
.status-tab.active {
  background: var(--accent, #f7b500);
  border-color: var(--accent, #f7b500);
  color: #11151c;
  font-weight: 600;
}
/* 状态计数：稍小、半透明，强调标签本身 */
.count {
  margin-left: 5px;
  font-size: 11px;
  opacity: 0.72;
  font-weight: 600;
}
</style>
