<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { subjectClient } from '@/services/subjectClient'
import TopicBoardModal from '@/components/TopicBoardModal.vue'
import type { BgmTopic } from '@shared/types'

const props = defineProps<{
  /** Bangumi 条目 id（provider id，非本地 subjects.id） */
  subjectId: string | null
}>()

/** 收起时显示的最新条数；展开后每页条数 */
const COLLAPSED = 2
const PAGE_SIZE = 6

const topics = ref<BgmTopic[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const notFound = ref(false)
/** false=收起（最新 2 条）；true=分页浏览 */
const expanded = ref(false)
const page = ref(0)

/** 当前打开讨论板悬浮窗的讨论串 id */
const openTopicId = ref<number | null>(null)

function fmtTime(ts: number): string {
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = Math.max(0, now - ts)
  const DAY = 86400
  if (diff < DAY * 3) {
    const d = Math.floor(diff / DAY)
    const h = Math.floor((diff % DAY) / 3600)
    const m = Math.floor((diff % 3600) / 60)
    if (d > 0) return `${d}d ago`
    if (h > 0) return `${h}h ago`
    if (m > 0) return `${m}m ago`
    return 'just now'
  }
  const dt = new Date(ts * 1000)
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`
}

// 列表按 updatedAt 倒序（接口本身按最后回复排序，防御性再排一次）
const sorted = ref<BgmTopic[]>([])
function resort() {
  sorted.value = [...topics.value].sort((a, b) => b.updatedAt - a.updatedAt)
}

const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)))
const visibleTopics = computed(() => {
  if (!expanded.value) return sorted.value.slice(0, COLLAPSED)
  const start = page.value * PAGE_SIZE
  return sorted.value.slice(start, start + PAGE_SIZE)
})

function toggleExpand() {
  expanded.value = !expanded.value
  if (expanded.value) page.value = 0
}
function prevPage() {
  if (page.value > 0) page.value -= 1
}
function nextPage() {
  if (page.value < totalPages.value - 1) page.value += 1
}

async function load() {
  topics.value = []
  sorted.value = []
  total.value = 0
  error.value = ''
  notFound.value = false
  expanded.value = false
  page.value = 0
  if (!props.subjectId) return
  loading.value = true
  try {
    const r = await subjectClient.getTopics(props.subjectId)
    topics.value = r.topics
    total.value = r.total
    notFound.value = r.notFound ?? false
    resort()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.subjectId, () => load())
</script>

<template>
  <div class="topics-box">
    <div class="tb-head-row">
      <h3>本作讨论</h3>
      <button v-if="sorted.length > COLLAPSED" class="tb-toggle" type="button" @click="toggleExpand">
        {{ expanded ? '收起' : `展开 (${total})` }}
      </button>
    </div>
    <p v-if="!subjectId" class="placeholder">无 Bangumi 条目，无法加载讨论。</p>
    <p v-else-if="loading" class="placeholder">加载中…</p>
    <p v-else-if="error" class="placeholder err">{{ error }}</p>
    <p v-else-if="notFound" class="placeholder warn">
      该作品在 Bangumi 上可能已不存在，或需登录后才能查看。
    </p>
    <p v-else-if="visibleTopics.length === 0" class="placeholder">暂无讨论。</p>
    <template v-else>
      <ul class="topic-list">
        <li v-for="t in visibleTopics" :key="t.id" class="topic-item" role="button" tabindex="0"
            :title="t.title" @click="openTopicId = t.id" @keydown.enter.prevent="openTopicId = t.id">
          <span class="topic-title">{{ t.title }}</span>
          <span class="topic-meta">
            <span v-if="t.creator?.nickname" class="topic-author">{{ t.creator.nickname }}</span>
            <span class="topic-time">{{ fmtTime(t.updatedAt) }}</span>
            <span class="topic-replies">{{ t.replyCount }} 回复</span>
          </span>
        </li>
      </ul>
      <!-- 展开后的分页 -->
      <div v-if="expanded && totalPages > 1" class="topic-pager">
        <button class="topic-page-btn" type="button" :disabled="page === 0" @click="prevPage">上一页</button>
        <span class="topic-page-info">第 {{ page + 1 }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <button class="topic-page-btn" type="button" :disabled="page >= totalPages - 1" @click="nextPage">下一页</button>
      </div>
    </template>

    <!-- 讨论板悬浮窗（仿单集评论悬浮窗） -->
    <TopicBoardModal :topic-id="openTopicId" @close="openTopicId = null" />
  </div>
</template>

<style scoped>
.topics-box {
  margin-top: 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.tb-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tb-head-row h3 {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}
.tb-toggle {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  background: rgba(255, 92, 138, 0.1);
  border: none;
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  transition: background .15s;
}
.tb-toggle:hover {
  background: rgba(255, 92, 138, 0.2);
}
.topic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.topic-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: border-color .15s;
}
.topic-item:hover {
  border-color: var(--accent);
}
.topic-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topic-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  flex-shrink: 0;
}
.topic-author {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topic-replies {
  background: rgba(255, 92, 138, 0.12);
  color: var(--accent);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
}
.topic-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}
.topic-page-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  cursor: pointer;
}
.topic-page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.topic-page-info {
  font-size: 12px;
  color: var(--text-dim);
}
.placeholder {
  font-size: 13px;
  color: var(--text-dim);
  margin: 4px 0;
}
.placeholder.err {
  color: var(--err);
}
.placeholder.warn {
  color: #e6a23c;
}
</style>
