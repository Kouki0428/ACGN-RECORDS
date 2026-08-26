<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEntityCard } from '@/composables/useEntityCard'
import { useTopicBoard } from '@/composables/useTopicBoard'
import { subjectClient } from '@/services/subjectClient'
import type { BgmTopic } from '@shared/types'

const entity = useEntityCard()
const board = useTopicBoard()

const open = ref(false)
const topics = ref<BgmTopic[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

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
    return '刚刚'
  }
  const dt = new Date(ts * 1000)
  return `${dt.getMonth() + 1}-${dt.getDate()}`
}

/** 点击标题：应用内打开讨论板悬浮窗（压入实体卡导航栈） */
function openTopic(t: BgmTopic) {
  board.setData(t.id)
  entity.push('topic', t.id)
}

/** 点击封面/条目名：应用内打开该作品悬浮卡 */
function openSubject(t: BgmTopic, e: MouseEvent) {
  e.stopPropagation()
  if (!t.subject?.id) return
  entity.openInstant('subject', t.subject.id)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    topics.value = await subjectClient.getTrendingTopics()
    loaded.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  if (open.value && !loaded.value && !loading.value) load()
}
</script>

<template>
  <!-- 收起态手柄 + 展开面板（定位由父级 .home 的 relative 提供） -->
  <button class="td-handle" type="button" :class="{ open }" title="热门条目讨论" @click="toggle">
    <span class="td-handle-text">热门讨论</span>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="td-handle-arrow">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>

  <!-- 向左展开的边栏面板 -->
  <Transition name="td-slide">
    <aside v-if="open" class="td-panel">
      <header class="td-head">
        <h3>热门条目讨论</h3>
        <button class="td-refresh" type="button" title="刷新" @click="load">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </header>

      <p v-if="loading && topics.length === 0" class="td-hint">加载中…</p>
      <p v-else-if="error" class="td-hint err">{{ error }}</p>
      <p v-else-if="topics.length === 0" class="td-hint">暂无热门讨论。</p>

      <ul v-else class="td-list">
        <li v-for="t in topics" :key="t.id" class="td-item">
          <button v-if="t.subject?.images?.medium || t.subject?.images?.common"
                  class="td-cover-btn" type="button" title="打开作品"
                  @click="openSubject(t, $event)">
            <img :src="t.subject?.images?.medium || t.subject?.images?.common" class="td-cover" alt="" loading="lazy" />
          </button>
          <span v-else class="td-cover td-cover--empty"></span>
          <div class="td-body">
            <button class="td-title" type="button" :title="t.title" @click="openTopic(t)">{{ t.title }}</button>
            <button v-if="t.subject" class="td-work" type="button" @click="openSubject(t, $event)">
              {{ t.subject.nameCN || t.subject.name }}
            </button>
            <div class="td-meta">
              <span>{{ fmtTime(t.updatedAt) }}</span>
              <span class="td-replies">{{ t.replyCount }} 回复</span>
            </div>
          </div>
        </li>
      </ul>
    </aside>
  </Transition>
</template>

<style scoped>
/* 收起态：主页右上角的普通胶囊按钮（参与文档流定位，不遮挡滚动条） */
.td-handle {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s var(--ease-out);
}
.td-handle:hover,
.td-handle.open {
  color: #fff;
  background: var(--accent-grad);
  border-color: transparent;
}
.td-handle-arrow {
  transition: transform .25s var(--ease-out);
}
.td-handle.open .td-handle-arrow {
  transform: rotate(180deg);
}
/* 展开面板：覆盖在内容之上，向左滑入；不挤压卡片网格 */
.td-panel {
  position: fixed;
  right: 12px;
  top: 132px; /* 位于主页 subtabs 行下方，不遮住右上角的收起/展开手柄 */
  bottom: 16px;
  width: min(340px, calc(100vw - 80px));
  z-index: 55;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-right: none;
  border-radius: 14px;
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.25);
}
.td-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(13px * var(--card-scale, 1)) calc(14px * var(--card-scale, 1));
  border-bottom: 1px solid var(--border-soft);
}
.td-head h3 {
  margin: 0;
  font-size: calc(15px * var(--card-scale, 1));
  color: var(--text);
}
.td-refresh {
  border: none;
  background: transparent;
  color: var(--text-dim);
  width: calc(28px * var(--card-scale, 1));
  height: calc(28px * var(--card-scale, 1));
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color .15s, background .15s;
}
.td-refresh:hover { color: var(--accent); background: var(--bg-elev); }
.td-hint {
  text-align: center;
  color: var(--text-dim);
  font-size: calc(13px * var(--card-scale, 1));
  padding: calc(32px * var(--card-scale, 1)) calc(14px * var(--card-scale, 1));
}
.td-hint.err { color: var(--err); }
/* 列表 */
.td-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: calc(10px * var(--card-scale, 1));
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--card-scale, 1));
}
.td-item {
  display: flex;
  gap: calc(10px * var(--card-scale, 1));
  padding: calc(8px * var(--card-scale, 1));
  border-radius: calc(10px * var(--card-scale, 1));
  transition: background .15s;
}
.td-item:hover { background: var(--bg-elev); }
.td-cover-btn {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: calc(6px * var(--card-scale, 1));
  overflow: hidden;
  line-height: 0;
}
.td-cover {
  width: calc(40px * var(--card-scale, 1));
  height: calc(53px * var(--card-scale, 1));
  object-fit: cover;
  border-radius: calc(6px * var(--card-scale, 1));
  background: var(--bg-elev);
}
.td-cover--empty { display: inline-block; }
.td-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: calc(3px * var(--card-scale, 1));
}
.td-title {
  text-align: left;
  border: none;
  background: none;
  padding: 0;
  font-size: calc(12.5px * var(--card-scale, 1));
  color: var(--text);
  line-height: 1.45;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.td-item:hover .td-title { color: var(--accent); }
.td-work {
  text-align: left;
  border: none;
  background: none;
  padding: 0;
  align-self: flex-start;
  font-size: calc(11px * var(--card-scale, 1));
  color: var(--accent);
  opacity: .85;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-work:hover { text-decoration: underline; opacity: 1; }
.td-meta {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--card-scale, 1));
  font-size: calc(11px * var(--card-scale, 1));
  color: var(--text-dim);
}
.td-replies {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  padding: 0 calc(7px * var(--card-scale, 1));
  border-radius: 999px;
  font-weight: 600;
}
/* 滑入动画 */
.td-slide-enter-active,
.td-slide-leave-active {
  transition: transform .26s cubic-bezier(.2,.8,.2,1), opacity .22s ease;
}
.td-slide-enter-from,
.td-slide-leave-to {
  transform: translateX(105%);
  opacity: 0;
}
</style>
