<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { apiClient } from '@/services/apiClient'
import { proxyImg } from '@/utils/imgProxy'
import { useEntityCard } from '@/composables/useEntityCard'
import { collectionClient } from '@/services/collectionClient'
import UserStatsModal from '@/components/UserStatsModal.vue'
import ActivityHeatmap from '@/components/ActivityHeatmap.vue'
import type { TimelineItem, UserStats } from '@shared/types'

const auth = useAuthStore()
const router = useRouter()
const items = ref<TimelineItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const page = ref(1)
const hasPrev = ref(false)
const hasNext = ref(false)
const rootEl = ref<HTMLElement | null>(null)

async function load(p = 1) {
  if (!auth.status.username) {
    error.value = null
    items.value = []
    page.value = 1
    hasPrev.value = false
    hasNext.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await apiClient.timeline(auth.status.username, p)
    items.value = res.items
    page.value = res.page
    hasPrev.value = res.hasPrev
    hasNext.value = res.hasNext
    // 翻页后回到列表顶部
    requestAnimationFrame(() => {
      if (rootEl.value) rootEl.value.scrollIntoView({ block: 'start' })
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    items.value = []
  } finally {
    loading.value = false
  }
}

function goPrev() {
  if (hasPrev.value && !loading.value) load(page.value - 1)
}
function goNext() {
  if (hasNext.value && !loading.value) load(page.value + 1)
}

/** 按时间线分组标题聚合（保持出现顺序） */
const groups = computed(() => {
  const out: { label: string; items: TimelineItem[] }[] = []
  for (const it of items.value) {
    let g = out.find((x) => x.label === it.group)
    if (!g) {
      g = { label: it.group, items: [] }
      out.push(g)
    }
    g.items.push(it)
  }
  return out
})

/** 动作首行拆成「动词 + 其余」，用于高亮动词 */
function splitAction(line: string): { verb: string; rest: string } {
  const i = line.indexOf(' ')
  if (i < 0) return { verb: line, rest: '' }
  return { verb: line.slice(0, i), rest: line.slice(i + 1) }
}

/** 标题行：单条目且 actionLine 未直接含显示名时展示；多条目（含「、」）不重复展示 */
function showTitle(it: TimelineItem): boolean {
  if (!it.title) return false
  if (it.actionLine.includes('、')) return false
  return true
}

const entityCard = useEntityCard()
function openSubject(id: number) {
  entityCard.open('subject', id)
}

// 统计悬浮窗：懒加载一次本地收藏聚合数据
const showStats = ref(false)
const userStats = ref<UserStats | null>(null)
async function openStats() {
  if (!userStats.value) {
    try {
      userStats.value = await collectionClient.userStats()
    } catch {
      userStats.value = null
    }
  }
  showStats.value = true
}

// 观看活动热力图数据（近一年按天标记次数）
const heatData = ref<{ day: string; count: number }[]>([])

onMounted(async () => {
  await auth.refresh()
  await load()
  // 观看活动热力图（失败静默，不影响时间胶囊）
  try {
    heatData.value = (await apiClient.heatmap(365)) ?? []
  } catch {
    heatData.value = []
  }
})
</script>

<template>
  <div class="detail" ref="rootEl">
    <!-- 观看活动热力图（近一年标记密度） -->
    <section class="panel">
      <div class="panel-head">
        <h3>观看活动 · 近一年</h3>
        <button
          class="stats-btn"
          type="button"
          title="年度报告"
          aria-label="年度报告"
          @click="router.push('/annual')"
        >
          <svg class="stats-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
            <line x1="2" y1="6.4" x2="14" y2="6.4" stroke="currentColor" stroke-width="1.4" />
            <line x1="5.5" y1="1.8" x2="5.5" y2="4.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <line x1="10.5" y1="1.8" x2="10.5" y2="4.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <ActivityHeatmap v-if="heatData.length" :data="heatData" />
      <p v-else class="hint">还没有标记记录，去标记一集试试。</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>时间胶囊</h3>
        <button
          class="stats-btn"
          type="button"
          title="数据统计"
          aria-label="数据统计"
          @click="openStats"
        >
          <svg
            class="stats-icon"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <rect x="6.5" y="1.8" width="3" height="7.2" rx="1.5" fill="currentColor" />
            <circle cx="8" cy="12.2" r="1.5" fill="currentColor" />
          </svg>
        </button>
      </div>
      <p class="hint">
        你的 Bangumi 操作历史（看过某集、读过某部、标记状态等）。数据来自
        bgm.tv 时间线页面的只读解析，非官方 API，可能随网页改版变动。
      </p>

      <p v-if="!loading && !error && !auth.status.loggedIn" class="panel-empty">
        请先在「设置」中登录 Bangumi，以查看你的时间胶囊。
      </p>
      <p v-else-if="loading" class="panel-empty">加载中…</p>
      <p v-else-if="error" class="panel-empty error">加载失败：{{ error }}</p>
      <p v-else-if="!items.length" class="panel-empty">
        {{ auth.status.loggedIn ? '该用户暂无时间胶囊动态' : '未获取到数据' }}
      </p>

      <template v-else>
        <div v-for="g in groups" :key="g.label" class="tc-group">
          <div class="tc-group-label">{{ g.label }}</div>
          <ul class="tc-list">
            <li
              v-for="it in g.items"
              :key="it.id"
              class="tc-item"
              @click="openSubject(it.subjectId)"
            >
              <div class="tc-covers" :class="{ 'tc-covers--multi': it.subjects.length > 1 }">
                <div
                  v-for="s in it.subjects"
                  :key="s.subjectId"
                  class="tc-cover"
                  @click.stop="openSubject(s.subjectId)"
                >
                  <img v-if="s.cover" :src="proxyImg(s.cover)" :alt="s.title" loading="lazy" />
                  <span v-else class="tc-cover--empty">无封面</span>
                </div>
              </div>
              <div class="tc-body">
                <div class="tc-action-line">
                  <span class="tc-verb">{{ splitAction(it.actionLine).verb }}</span>
                  <span class="tc-action-rest">{{ splitAction(it.actionLine).rest }}</span>
                </div>

                <div v-if="showTitle(it)" class="tc-title">
                  {{ it.title }}
                  <small v-if="it.subtitle && it.subtitle !== it.title" class="tc-sub">
                    {{ it.subtitle }}
                  </small>
                </div>

                <p v-if="it.info" class="tc-info">{{ it.info }}</p>

                <div v-if="it.showRating" class="tc-ratings">
                  <span v-if="it.myRating != null" class="tc-rating tc-my-rating">
                    <span class="tc-star">★</span> {{ it.myRating }}
                  </span>
                  <span v-if="it.siteRating != null" class="tc-rating tc-site-rating">
                    <span class="tc-star">★</span> {{ it.siteRating
                    }}<template v-if="it.siteRatingCount != null">
                      ({{ it.siteRatingCount }})</template>
                  </span>
                </div>

                <p v-if="it.comment" class="tc-comment">{{ it.comment }}</p>

                <div class="tc-foot">
                  <span class="tc-time">{{ it.time }}</span>
                  <span v-if="it.source" class="tc-source">· {{ it.source }}</span>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <div
        v-if="auth.status.loggedIn && (hasPrev || hasNext)"
        class="tc-pager"
      >
        <button
          class="tc-page-btn"
          type="button"
          :disabled="!hasPrev || loading"
          @click="goPrev"
        >
          ← 上一页
        </button>
        <span class="tc-page-num">第 {{ page }} 页</span>
        <button
          class="tc-page-btn"
          type="button"
          :disabled="!hasNext || loading"
          @click="goNext"
        >
          下一页 →
        </button>
      </div>
    </section>

    <UserStatsModal :visible="showStats" :stats="userStats" @close="showStats = false" />
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-head h3 {
  margin: 0;
}
.stats-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.stats-icon {
  display: block;
}
.stats-btn:hover {
  background: var(--bg-elev);
  color: var(--text);
  border-color: var(--text-dim);
}
.panel-empty {
  margin: 8px 0 0;
  color: var(--text-dim);
  font-size: 14px;
}
.panel-empty.error {
  color: #ff7a7a;
}
.tc-group + .tc-group {
  margin-top: 18px;
}
.tc-group-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
  padding: 4px 2px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.tc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tc-item {
  display: flex;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-deep, #14171c);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s;
}
.tc-item:hover {
  border-color: var(--accent-2, #5b9dff);
  transform: translateY(-1px);
}
.tc-covers {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}
.tc-cover {
  flex: 0 0 auto;
  width: 64px;
  height: 88px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-elev, #1c2230);
  cursor: pointer;
}
.tc-covers--multi .tc-cover {
  width: 52px;
  height: 72px;
}
.tc-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tc-cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 11px;
  color: var(--text-dim);
}
.tc-body {
  flex: 1;
  min-width: 0;
}
.tc-action-line {
  font-size: 14px;
  line-height: 1.45;
  word-break: break-all;
}
.tc-verb {
  font-weight: 700;
  color: var(--accent-2, #5b9dff);
}
.tc-action-rest {
  color: var(--text);
}
.tc-title {
  margin-top: 3px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}
.tc-sub {
  font-weight: 400;
  color: var(--text-dim);
  font-size: 12px;
  margin-left: 4px;
}
.tc-info {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
  word-break: break-all;
}
.tc-ratings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
}
.tc-rating {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.6;
  border: 1px solid var(--border);
}
.tc-my-rating {
  color: var(--rating-color);
  background: var(--rating-bg);
  border-color: var(--rating-border);
}
.tc-site-rating {
  color: var(--rating-site-color, var(--text-dim));
  background: var(--rating-site-bg, rgba(128, 128, 128, 0.14));
  border-color: var(--rating-site-border, rgba(128, 128, 128, 0.3));
  font-weight: 600;
}
.tc-site-rating .tc-star {
  color: var(--rating-site-color, var(--text-dim));
}
.tc-star {
  color: var(--rating-color);
}
.tc-comment {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tc-foot {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.tc-pager {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.tc-page-btn {
  padding: 7px 18px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elev, #1c2230);
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s;
}
.tc-page-btn:hover:not(:disabled) {
  border-color: var(--accent-2, #5b9dff);
}
.tc-page-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.tc-page-num {
  font-size: 13px;
  color: var(--text-dim);
  min-width: 56px;
  text-align: center;
}
</style>
