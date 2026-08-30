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
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color var(--dur-fast) ease,
    border-color var(--dur-fast) ease,
    background var(--dur-fast) ease,
    box-shadow var(--dur) var(--ease-out),
    transform 0.12s var(--ease-out);
}
.status-tab:hover {
  color: var(--text);
  border-color: var(--border-hover);
  background: var(--bg-elev);
}
.status-tab:active {
  transform: scale(0.96);
}
/* 激活态：品牌渐变胶囊 + 同色柔和投影，视觉重心明确 */
.status-tab.active {
  background: var(--accent-grad);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 3px 12px rgba(255, 92, 138, 0.32);
}
.status-tab.active:hover {
  filter: brightness(1.05);
}
/* 状态计数：独立小徽章，激活态反白半透明，未激活为暗色块 */
.count {
  margin-left: 6px;
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  font-weight: 600;
  background: var(--bg-elev);
  color: inherit;
}
.status-tab:not(.active) .count {
  color: var(--text-dim);
}
.status-tab.active .count {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
</style>
