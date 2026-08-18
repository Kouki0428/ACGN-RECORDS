<script setup lang="ts">
import { computed } from 'vue'
import type { Subject } from '@shared/types'
import { useCollectionModal } from '@/composables/useCollectionModal'
import { useCollectedStatus } from '@/composables/useCollectedStatus'
import { statusVerb } from '@/utils/collectionVerbs'

const props = defineProps<{ subject: Subject }>()

const pid = computed(() => props.subject.providerSubjectId)
// 该作品是否已收藏 + 当前状态（status 1-5）；未收藏为 null
const { status } = useCollectedStatus(() => pid.value)

const modal = useCollectionModal()
// 收藏状态的中文动词（想看 / 在读 / 玩过 …），已收藏时显示
const verb = computed(() => (status.value ? statusVerb(props.subject.category, status.value) : ''))

// 按 Bangumi 状态分色：
//  1 想看/读/玩、2 看过/读过/玩过、3 在看/在读/在玩 → 粉色
//  4 搁置、5 抛弃 → 灰色（抛弃额外加删除线）
const badgeClass = computed(() => {
  if (status.value == null) return ''
  if (status.value === 4 || status.value === 5) return 'st-gray'
  return 'st-pink'
})
// 仅 status 5（抛弃）加删除线
const isStrike = computed(() => status.value === 5)

// 未收藏：打开收藏悬浮窗（默认预选 想看/读/玩，由 useCollectionModal 默认值 1 决定）
function openAdd() {
  modal.open(props.subject.providerSubjectId, props.subject.category)
}
// 已收藏：打开收藏悬浮窗的「修改」模式，预填当前状态
function openEdit() {
  if (status.value == null) return
  modal.open(props.subject.providerSubjectId, props.subject.category, {
    mode: 'edit',
    currentStatus: status.value
  })
}
</script>

<template>
  <button v-if="status == null" class="fav-btn" type="button" @click.stop="openAdd">收藏</button>
  <button v-else class="collected-badge" :class="badgeClass" type="button" :title="'点击修改收藏状态'" @click.stop="openEdit">
    <span class="badge-text" :class="{ 'badge-strike': isStrike }">{{ verb }}</span>
  </button>
</template>

<style scoped>
.fav-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid var(--accent-2);
  background: transparent;
  color: var(--accent-2);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.fav-btn:hover {
  background: var(--accent-2);
  color: #fff;
}
/* 已收藏徽标：基础布局，具体颜色由 .st-* 决定 */
.collected-badge {
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
/* 1 想看/读/玩、2 看过/读过/玩过、3 在看/在读/在玩 → 粉色 */
.st-pink {
  border: 1px solid #ec6aa8;
  background: rgba(236, 106, 168, 0.16);
  color: #ec6aa8;
}
.st-pink:hover {
  background: rgba(236, 106, 168, 0.28);
  color: #f48cc0;
}
/* 4 搁置、5 抛弃 → 灰色 */
.st-gray {
  border: 1px solid #8a93a0;
  background: rgba(138, 147, 160, 0.16);
  color: #9aa3b0;
}
.st-gray:hover {
  background: rgba(138, 147, 160, 0.28);
  color: #b0b8c4;
}
/* 删除线作用在文字 span 上（按钮的 appearance 会抑制直接加在 button 上的 text-decoration） */
.badge-text {
  display: inline-block;
}
.badge-strike {
  text-decoration: line-through;
}
</style>
