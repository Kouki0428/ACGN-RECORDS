<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEntityCard } from '@/composables/useEntityCard'
import { useTopicBoard } from '@/composables/useTopicBoard'
import { useSettingsStore } from '@/stores/settings'
import { subjectClient } from '@/services/subjectClient'
import type { BgmTopic } from '@shared/types'

const entity = useEntityCard()
const board = useTopicBoard()
const settings = useSettingsStore()

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

async function load(force = false) {
  loading.value = true
  error.value = ''
  try {
    const list = await subjectClient.getTrendingTopics(force)
    // 最新的放在最前面：按最后回复时间降序，并列时按发布时间降序
    list.sort((a, b) => {
      const ba = b.updatedAt || b.createdAt
      const aa = a.updatedAt || a.createdAt
      if (ba !== aa) return ba - aa
      return b.createdAt - a.createdAt
    })
    topics.value = list
    loaded.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  // 展开时优先用 1 分钟缓存（不闪白、不重复请求）；点「刷新」才强制绕过缓存
  if (open.value) load(false)
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
    <aside v-if="open" class="td-panel" :class="{ glass: settings.immersiveGlow }">
      <header class="td-head">
        <h3>热门条目讨论</h3>
        <button class="td-refresh" type="button" title="刷新" @click="load(true)">
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
  border-radius: var(--radius-sm);
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
  /* 抽屉宽度提成变量：进出场用 right 位移（而非 transform）——Chromium 在 transform
     过渡期间不渲染 backdrop-filter（玻璃要等动画结束才出现）；right 动画则全程有效 */
  --td-w: min(340px, calc(100vw - 80px));
  position: fixed;
  right: 12px;
  top: 132px; /* 位于主页 subtabs 行下方，不遮住右上角的收起/展开手柄 */
  bottom: 16px;
  width: var(--td-w);
  z-index: 55;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-right: none;
  border-radius: var(--radius);
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.25);
}
/* ——「沉浸光感」开启时的液态玻璃面板（设置可关）——
   面板浮在主页彩色海报卡之上，折射滤镜外再叠 blur 保证标题文字可读；
   本体叠自上而下微透光 + 顶部内描边高光（与标题栏/悬浮窗同款光感） */
.td-panel.glass {
  isolation: isolate;
  overflow: hidden;
  border-color: transparent;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0.02) 42%,
      rgba(255, 255, 255, 0) 100%
    ),
    color-mix(in srgb, var(--bg-panel) calc(72% * var(--glass-k)), transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    -8px 0 30px rgba(0, 0, 0, 0.25);
}
.td-panel.glass::before {
  content: '';
  position: absolute;
  inset: -8px;
  z-index: -1;
  border-radius: var(--radius);
  backdrop-filter: url(#liquid-glass-distortion) saturate(1.5) blur(calc(10px * var(--glass-blur-k)));
  -webkit-backdrop-filter: url(#liquid-glass-distortion) saturate(1.5) blur(calc(10px * var(--glass-blur-k)));
}
.td-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border-soft);
}
.td-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}
.td-refresh {
  border: none;
  background: transparent;
  color: var(--text-dim);
  width: 28px;
  height: 28px;
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
  font-size: 13px;
  padding: 32px 14px;
}
.td-hint.err { color: var(--err); }
/* 列表 */
.td-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.td-item {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-sm);
  transition: background .15s;
}
.td-item:hover { background: var(--bg-elev); }
.td-cover-btn {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  overflow: hidden;
  line-height: 0;
}
.td-cover {
  width: 40px;
  height: 53px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
}
.td-cover--empty { display: inline-block; }
.td-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.td-title {
  text-align: left;
  border: none;
  background: none;
  padding: 0;
  font-size: 12.5px;
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
  font-size: 11px;
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
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
}
.td-replies {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  padding: 0 7px;
  border-radius: var(--radius-sm);
  font-weight: 600;
}
/* 滑入动画：只动 right，不动 opacity —— opacity < 1 会把面板变成 backdrop root，
   ::before 的 backdrop-filter 就采样不到背后的页面（玻璃整段消失、到位才出现）。
   隐藏位 = 面板完全滑出右缘（宽 + 12px 余量再留 8px 缓冲） */
.td-slide-enter-active,
.td-slide-leave-active {
  transition: right .26s cubic-bezier(.2,.8,.2,1);
}
.td-slide-enter-from,
.td-slide-leave-to {
  right: calc(var(--td-w) * -1 - 20px);
}
</style>
