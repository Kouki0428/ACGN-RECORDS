<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Category } from '@shared/types'
import { collectionClient } from '@/services/collectionClient'
import { useCollectionModal } from '@/composables/useCollectionModal'
import { useToast } from '@/composables/useToast'
import { parseAppError } from '@/utils/appError'
import { statusVerbs, collectionPhrase } from '@/utils/collectionVerbs'

const props = defineProps<{
  /** Bangumi 作品 id（字符串形式） */
  providerSubjectId: string
  /** 作品分类（决定动词：看 / 读 / 玩） */
  category: Category
}>()

const modal = useCollectionModal()
const toast = useToast()

// 是否已收藏 + 收藏状态 + 吐槽 + 我的评价评分
const status = ref<number | null>(null)
const comment = ref<string | null>(null)
const privateFlag = ref<boolean>(false)
const rating = ref<number | null>(null)
const loading = ref(false)

const statusButtons = computed(() => {
  const list = statusVerbs(props.category)
  return [1, 2, 3, 4, 5].map((s, i) => ({ status: s, label: list[i] }))
})

const phrase = computed(() => (status.value ? collectionPhrase(props.category, status.value) : ''))

async function loadExisting() {
  if (!props.providerSubjectId) {
    status.value = null
    return
  }
  loading.value = true
  try {
    const r = await collectionClient.getExisting(props.providerSubjectId)
    status.value = r.status
    comment.value = r.comment
    privateFlag.value = !!r.private
    rating.value = r.rating ?? null
  } catch {
    status.value = null
  } finally {
    loading.value = false
  }
}

// 未收藏时点击某个状态标签 → 打开收藏悬浮窗（add 模式，该状态高亮预选）
function onPick(s: number) {
  modal.open(props.providerSubjectId, props.category, { mode: 'add', currentStatus: s })
}

// 已收藏时点击「修改」→ edit 模式（预填当前状态 + 吐槽 + 仅自己可见）
function onEdit() {
  if (status.value == null) return
  modal.open(props.providerSubjectId, props.category, {
    mode: 'edit',
    currentStatus: status.value,
    comment: comment.value ?? undefined,
    private: privateFlag.value,
    rating: rating.value
  })
}

// 已收藏时点击「删除」→ 直接删除本地收藏并同步 Bangumi（refreshTick 会刷新本栏）
async function onDelete() {
  if (status.value == null) return
  try {
    await modal.remove()
    toast.ok('已取消收藏')
  } catch (e) {
    toast.err(parseAppError(e, '取消收藏失败').message)
    console.warn('[CollectionBar] 删除收藏失败：', e)
  }
}

onMounted(loadExisting)
// providerSubjectId 变化（切换作品）→ 重新拉取
watch(() => props.providerSubjectId, loadExisting)
// 收藏悬浮窗保存 / 删除成功后 → 刷新本栏状态
watch(
  () => [modal.refreshTick.value, modal.providerSubjectId.value],
  () => {
    if (modal.providerSubjectId.value === props.providerSubjectId) loadExisting()
  }
)
</script>

<template>
  <div class="col-bar">
    <!-- 未收藏：一排可点状态标签 -->
    <div v-if="status == null" class="col-tags">
      <button
        v-for="b in statusButtons"
        :key="b.status"
        type="button"
        class="col-tag"
        :title="`标记为「${b.label}」`"
        @click="onPick(b.status)"
      >
        {{ b.label }}
      </button>
    </div>

    <!-- 已收藏：文字 + 修改 / 删除 -->
    <div v-else class="col-existing">
      <span class="col-phrase">{{ phrase }}</span>
      <div class="col-actions">
        <button type="button" class="col-edit" @click="onEdit">修改</button>
        <button type="button" class="col-del" @click="onDelete">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.col-bar {
  margin: 8px 0 4px;
}
.col-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.col-tag {
  padding: 5px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.col-tag:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.col-existing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.col-phrase {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.col-actions {
  display: inline-flex;
  gap: 8px;
}
.col-edit,
.col-del {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  transition: all 0.15s ease;
}
.col-edit:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.col-del:hover {
  border-color: var(--err);
  color: var(--err);
}
</style>
