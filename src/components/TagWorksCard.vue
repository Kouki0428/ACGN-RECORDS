<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import type { ArchiveTagSubject } from '@shared/types'
import { useEntityCard } from '@/composables/useEntityCard'
import { archiveClient } from '@/services/archiveClient'
import { proxyImg } from '@/utils/imgProxy'

const { state, back, close, canBack, push } = useEntityCard()

// 细分类目 → 展示标签（与 Bangumi 分类一致：书籍按 platform/tags 细分 小说/漫画）
function catInfo(category: string): { label: string; cls: string } {
  switch (category) {
    case 'anime':
      return { label: '动画', cls: 'cat-anime' }
    case 'light_novel':
      return { label: '小说', cls: 'cat-light_novel' }
    case 'manga':
      return { label: '漫画', cls: 'cat-manga' }
    case 'galgame':
      return { label: '游戏', cls: 'cat-galgame' }
    default:
      return { label: '其他', cls: 'cat-other' }
  }
}

const tag = computed(() => state.value?.tag ?? '')
const works = ref<ArchiveTagSubject[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// —— 筛选 / 排序 / 分页（全部基于已取回的离线列表，前端处理，零网络依赖）——
const PAGE_SIZE = 30
type FilterKey = 'all' | 'anime' | 'light_novel' | 'manga' | 'galgame'
type SortKey = 'rank' | 'date'
const filterType = ref<FilterKey>('all')
const sortMode = ref<SortKey>('rank')
const page = ref(1)
const resultsEl = ref<HTMLElement | null>(null)
// 已加载的标签（用于区分「真正切换标签」与「进作品卡→返回」的 tag 回环，避免返回时重置页码）
const loadedTag = ref('')
// 结果区滚动位置（离卡时记下、回卡时还原，避免返回被拉回顶部）
const tagScrollTop = ref(0)

const filterOpts: { v: FilterKey; label: string }[] = [
  { v: 'all', label: '全部' },
  { v: 'anime', label: '动画' },
  { v: 'light_novel', label: '小说' },
  { v: 'manga', label: '漫画' },
  { v: 'galgame', label: '游戏' }
]
const sortOpts: { v: SortKey; label: string }[] = [
  { v: 'rank', label: '排名' },
  { v: 'date', label: '日期' }
]

const filteredWorks = computed(() => {
  if (filterType.value === 'all') return works.value
  return works.value.filter((w) => w.category === filterType.value)
})
// 排名：名次越小越靠前（null 排最后）；日期：新版在前（ISO 字符串直接比较）。
const sortedWorks = computed(() => {
  const arr = filteredWorks.value.slice()
  if (sortMode.value === 'rank') {
    arr.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
  } else {
    arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }
  return arr
})
const totalPages = computed(() => Math.max(1, Math.ceil(sortedWorks.value.length / PAGE_SIZE)))
const pagedWorks = computed(() => {
  const s = (page.value - 1) * PAGE_SIZE
  return sortedWorks.value.slice(s, s + PAGE_SIZE)
})

function scrollResultsToTop() {
  nextTick(() => {
    if (resultsEl.value) resultsEl.value.scrollTop = 0
  })
}
function goPage(delta: number) {
  const next = Math.min(totalPages.value, Math.max(1, page.value + delta))
  if (next === page.value) return
  page.value = next
  scrollResultsToTop()
}

async function load() {
  const t = tag.value
  if (!t) return
  loading.value = true
  error.value = null
  works.value = []
  try {
    works.value = await archiveClient.searchByTag(t)
    loadedTag.value = t
    // 离线 Archive 的 image_url 列全量恒空 → 列表先秒显（文字/分类/评分），
    // 先补当前页封面（即时可见），再后台补齐其余页（翻页秒显 + 回写 Archive 持久缓存）。
    void fillCovers()
    void fillCoversBackground()
  } catch (e) {
    console.warn('[TagWorksCard] 按标签取作品失败：', e)
    error.value = '读取离线库失败'
  } finally {
    loading.value = false
  }
}

// 批量按 id 匿名补图（仅补「当前页」可见作品，避免一次拉数百张）；
// 成功取到的封面就地写入 works（pagedWorks 是其子集引用），触发重渲染。
async function fetchCovers(ids: number[]) {
  if (!ids.length) return
  try {
    const map = await archiveClient.ensureCovers(ids)
    if (!map || !Object.keys(map).length) return
    for (const w of works.value) {
      const url = map[w.id]
      if (url) w.image_url = url
    }
  } catch (e) {
    console.warn('[TagWorksCard] 补封面失败（保留无封面占位）：', e)
  }
}

// 补当前页缺失封面
async function fillCovers() {
  const ids = pagedWorks.value.filter((w) => !w.image_url).map((w) => w.id)
  await fetchCovers(ids)
}
// 后台补齐其余页缺失封面：翻页即秒显；已回写 Archive 的封面会被 ensureCovers 的 IN 查询跳过。
function fillCoversBackground() {
  const pageIds = new Set(pagedWorks.value.map((w) => w.id))
  const rest = works.value.filter((w) => !w.image_url && !pageIds.has(w.id)).map((w) => w.id)
  void fetchCovers(rest)
}

onMounted(load)
onDeactivated(() => {
  // 离开（进作品卡）时记下结果区滚动位置，返回时还原
  if (resultsEl.value) tagScrollTop.value = resultsEl.value.scrollTop
})
onActivated(async () => {
  await nextTick()
  if (resultsEl.value) resultsEl.value.scrollTop = tagScrollTop.value
})
// 切换标签：仅当标签【真正变化成另一个不同标签】时才重置筛选/排序/页码并重载。
// 从本标签卡 push 进作品卡时 state.tag 会变为 undefined，返回时又变回原标签——
// 这种「undefined → 原标签」的回环必须跳过，否则返回会跳回第一页。
watch(tag, (newTag) => {
  if (newTag && newTag !== loadedTag.value) {
    filterType.value = 'all'
    sortMode.value = 'rank'
    page.value = 1
    load()
  }
})
// 筛选/排序变化：回到第一页
watch([filterType, sortMode], () => {
  page.value = 1
  scrollResultsToTop()
})
// 翻页：补当页封面
watch(page, () => fillCovers())

function onWorkClick(id: number) {
  // 从标签列表点开作品：压栈进入作品卡（返回可回标签列表）
  push('subject', id)
}
</script>

<template>
  <div class="tag-works-card" @click.stop>
    <div class="subject-head">
      <button
        v-if="canBack"
        class="entity-back back-btn"
        type="button"
        title="返回上级"
        aria-label="返回上级"
        @click="back"
      >
        <svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg>
      </button>
      <span class="title">标签：{{ tag }}</span>
      <button class="close" type="button" title="关闭" aria-label="关闭" @click="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 筛选（类目）+ 排序：固定在头部下方，滚动结果时保持可见 -->
    <div class="tag-toolbar">
      <div class="filters">
        <button
          v-for="f in filterOpts"
          :key="f.v"
          :class="{ active: filterType === f.v }"
          type="button"
          @click="filterType = f.v"
        >{{ f.label }}</button>
      </div>
      <div class="sorts">
        <span class="sort-label">排序</span>
        <button
          v-for="s in sortOpts"
          :key="s.v"
          :class="{ active: sortMode === s.v }"
          type="button"
          @click="sortMode = s.v"
        >{{ s.label }}</button>
      </div>
    </div>

    <div v-if="loading" class="subject-body">
      <div class="ph">加载中…</div>
    </div>
    <div v-else-if="error" class="subject-body">
      <div class="ph err">{{ error }}</div>
    </div>
    <div v-else-if="works.length === 0" class="subject-body">
      <div class="ph">离线库中没有带有「{{ tag }}」标签的作品</div>
    </div>

    <div v-else class="subject-body tag-body" ref="resultsEl">
      <div class="grid">
        <div v-for="w in pagedWorks" :key="w.id" class="rcard" @click="onWorkClick(w.id)">
          <div class="r-avatar">
            <img v-if="w.image_url" :src="proxyImg(w.image_url)" :alt="w.name_cn || w.name" loading="lazy" />
            <span v-else class="r-avatar--empty">无封面</span>
          </div>
          <div class="rtitle">{{ w.name_cn || w.name }}</div>
          <div class="rcard-foot">
            <span class="cat-badge" :class="catInfo(w.category).cls">{{ catInfo(w.category).label }}</span>
            <span class="tw-rating" :class="{ 'tw-rating--none': w.score == null }">★ {{ w.score != null ? w.score.toFixed(1) : '—' }}</span>
          </div>
        </div>
      </div>

      <div class="pager" v-if="totalPages > 1">
        <button class="pg-btn" type="button" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
        <span class="pg-info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ sortedWorks.length }} 部</span>
        <button class="pg-btn" type="button" :disabled="page >= totalPages" @click="goPage(1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tag-works-card {
  width: 100%;
  max-width: none;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.subject-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}
.subject-head .title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subject-head .close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  margin-left: auto;
  border: none;
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease, color 0.15s ease;
}
.subject-head .close svg {
  width: 16px;
  height: 16px;
  display: block;
}
.subject-head .close:hover {
  background: var(--accent-2);
  color: #fff;
}
.subject-body {
  flex: 1;
  min-height: 50vh;
  overflow-y: auto;
  padding: 16px;
}
.ph {
  padding: 40px 0;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}
.ph.err {
  color: #ff7a7a;
}
.tag-body {
  padding: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}
.rcard {
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 8px 8px 6px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.15s;
}
.rcard:hover {
  transform: translateY(-2px);
  border-color: var(--accent-2);
}
.rcard .r-avatar {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-deep);
}
.rcard .r-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.rcard .r-avatar--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.rtitle {
  margin: 6px 2px 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 30px;
}
.rcard-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}
.cat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.6;
  color: #fff;
  border: 1px solid transparent;
}
.cat-badge.cat-anime {
  background: #5b9dff;
}
.cat-badge.cat-manga {
  background: #e0853e;
}
.cat-badge.cat-galgame {
  background: #c879e0;
}
.cat-badge.cat-real {
  background: #8a93a6;
}
.cat-badge.cat-other {
  background: #6b7280;
}
/* 评分徽章：与「看过」作品卡片的 .site-rating 胶囊完全一致（同套主题变量，深/浅色自适应） */
.tw-rating {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.6;
  white-space: nowrap;
  color: var(--rating-site-color);
  background: var(--rating-site-bg);
  border: 1px solid var(--rating-site-border);
}
/* 无站点评分时的占位（对应卡片「★ —」） */
.tw-rating--none {
  opacity: 0.7;
}
/* 筛选 + 排序工具条：固定头部下方，结果与工具条各自独立（工具条不随结果滚动） */
.tag-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 10px 16px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filters button,
.sorts button {
  padding: 5px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.filters button:hover,
.sorts button:hover {
  color: var(--text);
  border-color: var(--text-dim);
}
.filters button.active,
.sorts button.active {
  background: var(--bg-elev);
  border-color: var(--accent-2);
  color: var(--text);
}
.sorts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.sort-label {
  font-size: 12px;
  color: var(--text-dim);
  margin-right: 2px;
}
.cat-badge.cat-light_novel {
  background: #57c08d;
}
/* 分页条（位于可滚动结果区内部，随内容一起滚动，非固定底部） */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 8px 16px 2px;
  margin-top: 10px;
  flex-shrink: 0;
}
.pg-btn {
  padding: 6px 18px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pg-btn:hover:not(:disabled) {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.pg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pg-info {
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}
</style>
