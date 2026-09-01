<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { apiClient } from '@/services/apiClient'
import { subjectClient } from '@/services/subjectClient'
import { useAuthStore } from '@/stores/auth'
import ResultCollectButton from '@/components/ResultCollectButton.vue'
import type { Subject, Category, SearchQuery, SearchResultItem, ChannelTag } from '@shared/types'
import { proxyImg } from '@/utils/imgProxy'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { useModalZ } from '@/composables/useModalZ'
import { useEntityCard } from '@/composables/useEntityCard'
import { useRecent } from '@/composables/useRecent'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const auth = useAuthStore()
// 未登录时不允许搜人物（v0 角色/人物检索需令牌，匿名返回空），显示登录入口而非模糊报错
const personNeedsLogin = computed(() => domain.value === 'person' && !auth.status.loggedIn)
async function doLogin() {
  try {
    await auth.login()
  } catch {
    /* auth.error 已记录，UI 下方显示 */
  }
}

const { isOpen, close: rawClose } = useSearchOverlay()
// 最后打开的悬浮窗抬到最上层
const z = useModalZ(isOpen)
const entity = useEntityCard()
const { searchHistory, recentSubjects, pushSearchTerm, removeSearchTerm, clearSearchHistory, clearRecentSubjects } = useRecent()
// 「最近打开」的 NSFW 标记缓存：按 id 从主库/存档批量查询（旧记录可能缺 nsfw 字段）
const recentNsfw = ref<Record<string, boolean>>({})
async function refreshRecentNsfw() {
  const ids = recentSubjects.value.map((s) => s.id).filter((x) => Number.isFinite(x) && x > 0)
  if (!ids.length) {
    recentNsfw.value = {}
    return
  }
  try {
    recentNsfw.value = await subjectClient.nsfwBatch(ids)
  } catch {
    /* 查询失败则仅依赖记录自带的 nsfw，静默 */
  }
}
watch(recentSubjects, refreshRecentNsfw, { immediate: true })
// 实体卡（角色/CV/作品）是否正叠在搜索之上。是的话搜索遮罩变「透明基底」：
// 不再关闭、只隐藏自身卡片内容，让实体卡干净地叠在上面；关闭实体卡时底层搜索自然显现，
// 从而「关闭实体卡 → 回到搜索」天然成立，无需 returnTo 重开（避免偶发全部关闭）。
const entityIsOpen = entity.isOpen

// 搜索遮罩的进入/离开过渡受 instant 控制（从其它路径瞬时关闭搜索时可跳过动画）；
// skipReset 用于「保留上次检索结果」的分支（详见下方 watch）。
// leaving：搜索遮罩正处于 leave 过渡中。当「从搜索点开实体卡再点 X 关全部」时，
// 实体卡与搜索遮罩同时关闭、同时离场；此时不能让 search-overlay 在离场瞬间解除
// behind（解除会露出搜索卡片 + 暗化层，造成一闪）。故离场期间保持 behind（透明+卡片隐藏）。
const instant = ref(false)
const skipReset = ref(false)
const leaving = ref(false)
function close(opts: { instant?: boolean } = {}) {
  if (opts.instant) {
    instant.value = true
    rawClose()
    nextTick(() => {
      instant.value = false
    })
  } else {
    rawClose()
  }
}

const kw = ref('')
const results = ref<SearchResultItem[]>([])
// 前端分页：每页 30 个（主进程已返回全部结果，这里仅做分页展示）。
// 条目 / 人物的页码各自独立（互不同步）；切到某个 domain 时该 domain 页码归 1。
const PAGE_SIZE = 30
const subjectPage = ref(1)
const personPage = ref(1)
const tagPage = ref(1)
const resultsEl = ref<HTMLElement | null>(null)
const currentPage = computed(() => {
  if (domain.value === 'subject') return subjectPage.value
  if (domain.value === 'tag') return tagPage.value
  return personPage.value
})
const totalPages = computed(() => Math.max(1, Math.ceil(results.value.length / PAGE_SIZE)))
const pagedResults = computed<SearchResultItem[]>(() => {
  const s = (currentPage.value - 1) * PAGE_SIZE
  return results.value.slice(s, s + PAGE_SIZE)
})
// 翻页：写入「当前 domain 自己」的页码，并让结果区滚动回顶部。
function goPage(delta: number) {
  const next = Math.min(totalPages.value, Math.max(1, currentPage.value + delta))
  if (domain.value === 'subject') subjectPage.value = next
  else if (domain.value === 'tag') tagPage.value = next
  else personPage.value = next
  scrollResultsToTop()
}
async function scrollResultsToTop() {
  await nextTick()
  if (resultsEl.value) resultsEl.value.scrollTop = 0
}
const searching = ref(false)
const failed = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

// 一级分类：条目 / 人物 / 标签
const domain = ref<'subject' | 'person' | 'tag'>('subject')
// 二级分类
const subjectType = ref<'all' | 'anime' | 'book' | 'game'>('all')
const personType = ref<'all' | 'virtual' | 'real'>('all')
// 标签搜索：类型过滤（p1 type）
const tagType = ref<number | undefined>(undefined)
const hotTags = ref<ChannelTag[]>([])
const tagResults = ref<ChannelTag[]>([])
// 全部类型（「全部」栏）：仅 书籍/动画/游戏（移除 音乐/三次元，减少请求提速）
const ALL_TYPES = [1, 2, 4]
async function loadHotTags() {
  try {
    if (tagType.value === undefined) {
      // 全部：合并所有类型的热门标签
      const countBy = new Map<string, number>()
      for (const t of ALL_TYPES) {
        const r = await apiClient.channelTags(t)
        for (const tag of r.data ?? []) {
          const prev = countBy.get(tag.name) ?? 0
          if (tag.count > prev) countBy.set(tag.name, tag.count)
        }
      }
      hotTags.value = [...countBy.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
    } else {
      const r = await apiClient.channelTags(tagType.value)
      hotTags.value = (r.data ?? []).slice(0, 20)
    }
  } catch {
    hotTags.value = []
  }
}
watch(tagType, loadHotTags)

const subjectOpts = [
  { v: 'all', label: '全部' },
  { v: 'anime', label: '动画' },
  { v: 'book', label: '书籍' },
  { v: 'game', label: '游戏' }
] as const
const personOpts = [
  { v: 'all', label: '全部' },
  { v: 'virtual', label: '虚拟' },
  { v: 'real', label: '现实' }
] as const
// 标签搜索：类型过滤（Bangumi type）
const tagTypeOpts = [
  { v: undefined, label: '全部' },
  { v: 2, label: '动画' },
  { v: 1, label: '书籍' },
  { v: 4, label: '游戏' }
] as const

const CAT_LABELS: Record<Category, string> = {
  anime: '动画',
  light_novel: '小说',
  manga: '漫画',
  galgame: '游戏'
}

function buildQuery(): SearchQuery {
  return {
    keyword: kw.value.trim(),
    // 标签模式不走 unifiedSearch（走 p1 searchByTag），这里占位为 subject 以免类型报错
    domain: domain.value === 'tag' ? 'subject' : domain.value,
    subjectType: domain.value === 'subject' ? subjectType.value : undefined,
    personType: domain.value === 'person' ? personType.value : undefined
  }
}

let timer: number | undefined
// 请求序号：每次发起搜索自增；请求返回时若序号已过期则丢弃结果。
// 防止「快速切换 条目/人物 或翻页」时，旧请求（如较慢的条目全量分页）后到并覆盖新结果，
// 表现为「人物搜索串到作品 / 作品搜索串到人物」的错乱。
let searchSeq = 0
function scheduleSearch() {
  const q = kw.value.trim()
  if (!q) {
    results.value = []
    tagResults.value = []
    searching.value = false
    failed.value = ''
    return
  }
  searching.value = true
  failed.value = ''
  if (timer) clearTimeout(timer)
  timer = window.setTimeout(() => doSearch(), 200)
}

async function doSearch() {
  const q = kw.value.trim()
  if (!q) {
    results.value = []
    tagResults.value = []
    searching.value = false
    return
  }
  if (personNeedsLogin.value) {
    results.value = []
    tagResults.value = []
    searching.value = false
    return
  }
  const seq = ++searchSeq
  failed.value = ''
  searching.value = true
  try {
    if (domain.value === 'tag') {
      // 标签模式：搜索「标签」候选（p1 频道标签 + 关键词过滤），点击后打开标签悬浮窗
      // tagType 为 undefined = 「全部」：IPC 端遍历全部类型合并标签
      const tr = await apiClient.searchTags({ keyword: q, type: tagType.value })
      if (seq !== searchSeq) return
      tagResults.value = tr.data
      results.value = []
      pushSearchTerm(q)
      tagPage.value = 1
      scrollResultsToTop()
      return
    }
    const res = await apiClient.search(buildQuery())
    // 丢弃过期请求的结果：仅采用「最后一次」搜索的返回，杜绝条/人串台。
    if (seq !== searchSeq) return
    results.value = res
    // 搜索结果补 NSFW 标记（存档/主库兜底，避免列表接口/旧数据缺该字段导致不模糊）
    const subjIds = res
      .filter((r): r is Extract<SearchResultItem, { kind: 'subject' }> => r.kind === 'subject')
      .map((r) => Number(r.subject.providerSubjectId))
      .filter((x) => Number.isFinite(x) && x > 0)
    if (subjIds.length) {
      subjectClient
        .nsfwBatch(subjIds)
        .then((map) => {
          if (seq !== searchSeq) return
          for (const r of results.value) {
            if (r.kind === 'subject') {
              const id = String(r.subject.providerSubjectId)
              if (map[id]) r.subject.nsfw = true
            }
          }
        })
        .catch(() => {})
    }
    pushSearchTerm(q)
    // 新一次搜索（含切换 domain / 切换二级分类）从第一页开始；各 domain 独立页码。
    // 注：标签模式已在上方分支内重置 tagPage 并提前返回，此处仅剩 条目/人物。
    if (domain.value === 'subject') subjectPage.value = 1
    else personPage.value = 1
    scrollResultsToTop()
  } catch (e) {
    if (seq !== searchSeq) return
    failed.value = '检索失败：' + (e instanceof Error ? e.message : String(e))
    results.value = []
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

// 切换一级/二级分类时：先清空上一域的结果并作废在途请求，避免旧结果残留/串台；
// 有搜索词则按新条件用新请求重新检索（独立 200ms 防抖）。
watch([domain, subjectType, personType, tagType], () => {
  searchSeq++ // 作废任何在途的旧搜索请求
  results.value = []
  tagResults.value = []
  if (kw.value.trim()) {
    searching.value = true
    failed.value = ''
    scheduleSearch()
  } else {
    searching.value = false
    failed.value = ''
  }
  // 进入标签模式时同步加载热门标签建议，并后台预热标签缓存使首次搜索秒回
  if (domain.value === 'tag') {
    void loadHotTags()
    void apiClient.warmTagCache(ALL_TYPES)
  }
})

function keyOf(r: SearchResultItem): string {
  return r.kind === 'subject'
    ? `s:${r.subject.provider}:${r.subject.providerSubjectId}`
    : `p:${r.personKind}:${r.id}`
}

function openSubject(subject: Subject) {
  // 点击搜索结果中的条目 → 打开作品悬浮窗（替代跳转栏目列表页）。
  // 不关闭搜索：搜索作为底层「透明基底」保持挂载，实体卡叠其上；关闭实体卡时搜索自然显现。
  const id = Number(subject.providerSubjectId)
  if (!Number.isNaN(id)) entity.openInstant('subject', id)
}

function openPerson(r: Extract<SearchResultItem, { kind: 'person' }>) {
  // 点击搜索结果中的人物/角色 → 打开应用内详情卡片（替代跳转 bgm 网页）
  const id = Number(r.id)
  if (!Number.isNaN(id)) entity.openInstant(r.personKind, id, [])
}

// 整行点击：角色 / CV / 作品 均打开对应悬浮窗（与详情页行为一致）
function onResultClick(r: SearchResultItem) {
  if (r.kind === 'subject') openSubject(r.subject)
  else openPerson(r)
}

function clearKw() {
  kw.value = ''
  results.value = []
  tagResults.value = []
  searching.value = false
  inputEl.value?.focus()
}

// 点击历史词 → 直接填入并立即检索（跳过防抖）
function applyHistoryTerm(term: string) {
  kw.value = term
  if (domain.value === 'person') domain.value = 'subject'
  void doSearch()
  inputEl.value?.focus()
}

// 点击搜索结果中的标签 → 打开对应标签的作品悬浮窗（kind='tag'，TagWorksCard）
function openTagWorks(tag: string) {
  entity.openTag(tag)
}

// 删除单条历史词（不触发检索）
function dropHistoryTerm(term: string) {
  removeSearchTerm(term)
}

function onOverlayClick() {
  // 实体卡叠在搜索之上（behind）时搜索遮罩 pointer-events:none，本函数不会触发；
  // 这里再加一道守卫，确保即使处于 behind 态也绝不会误关底层搜索。
  if (!entityIsOpen.value) close()
}

function onKey(e: KeyboardEvent) {
  // 实体卡在上方时，Esc 只应关闭实体卡（由 EntitySubjectCard 的监听处理），
  // 否则两侧监听同时生效会把底层搜索也关掉 → 「全部关闭」。故 behind 态下忽略。
  if (e.key === 'Escape' && !entityIsOpen.value) close()
}

watch(isOpen, async (v) => {
  if (v) {
    // 每次真正打开搜索（侧边栏/快捷键）时清空并重置分类，开始一次干净的检索。
    // 注：从搜索点开实体卡时搜索不再关闭（作为底层透明基底保持挂载），故本 watch
    // 不会在「关闭实体卡回到搜索」时重复触发——搜索 isOpen 始终为真，仅卡片内容显隐。
    if (!skipReset.value) {
      kw.value = ''
      results.value = []
      tagResults.value = []
      hotTags.value = []
      failed.value = ''
      searching.value = false
      domain.value = 'subject'
      subjectType.value = 'all'
      personType.value = 'all'
      auth.refresh().catch(() => {})
    }
    await nextTick()
    inputEl.value?.focus()
    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('keydown', onKey)
  }
})
</script>

<template>
  <Transition name="overlay" :disabled="instant" @before-leave="leaving = true" @after-leave="leaving = false">
    <div v-if="isOpen" class="search-overlay" :class="{ behind: entityIsOpen || leaving }" :style="{ zIndex: z }" @click="onOverlayClick">
      <div class="search-card" v-show="!entityIsOpen && !leaving" :class="{ 'glow-card': settings.immersiveGlow && settings.subjectCardGlow }" @click.stop>
        <!-- 搜索框 + 关闭叉同一行：叉在搜索框右侧、与搜索框上下居中对齐 -->
        <div class="search-row">
          <!-- 搜索框 -->
          <div class="search-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              ref="inputEl"
              v-model="kw"
              type="text"
              :placeholder="domain === 'tag' ? '搜索标签…' : '搜索…'"
              @input="scheduleSearch"
            />
            <button v-if="kw" class="clear" type="button" title="清除" @click="clearKw">清除</button>
          </div>
          <!-- 关闭卡片的叉 -->
          <button class="close" type="button" title="关闭搜索" aria-label="关闭搜索" @click="() => close()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <!-- 一级分类：条目 / 人物 / 标签 -->
        <div class="cat-tabs">
          <button :class="{ active: domain === 'subject' }" @click="domain = 'subject'">条目</button>
          <button :class="{ active: domain === 'person' }" @click="domain = 'person'">人物</button>
          <button :class="{ active: domain === 'tag' }" @click="domain = 'tag'">标签</button>
        </div>

        <!-- 二级分类 -->
        <div class="cat-sub">
          <template v-if="domain === 'subject'">
            <button
              v-for="opt in subjectOpts"
              :key="opt.v"
              :class="{ active: subjectType === opt.v }"
              @click="subjectType = opt.v"
            >{{ opt.label }}</button>
          </template>
          <template v-else-if="domain === 'person'">
            <button
              v-for="opt in personOpts"
              :key="opt.v"
              :class="{ active: personType === opt.v }"
              @click="personType = opt.v"
            >{{ opt.label }}</button>
          </template>
          <template v-else>
            <button
              v-for="opt in tagTypeOpts"
              :key="opt.v"
              :class="{ active: tagType === opt.v }"
              @click="tagType = opt.v"
            >{{ opt.label }}</button>
          </template>
        </div>

        <!-- 结果区 -->
        <div class="results" ref="resultsEl">
          <div v-if="searching" class="ph">检索中…</div>
          <div v-else-if="failed" class="ph err">{{ failed }}</div>
          <div v-else-if="personNeedsLogin" class="ph">
            <p>搜索角色 / 人物需要先登录 Bangumi。</p>
            <button class="btn btn--primary" :disabled="auth.busy" @click="doLogin">
              {{ auth.busy ? '登录中…' : '去登录' }}
            </button>
            <div v-if="auth.error" class="ph err">{{ auth.error }}</div>
          </div>
          <!-- 空关键词：搜索历史 + 最近浏览（高频重复路径的快捷入口） -->
          <div v-else-if="!kw.trim()" class="ph ph--start">
            <template v-if="domain === 'tag'">
              <div v-if="hotTags.length" class="start-block">
                <div class="start-head"><span>热门标签</span></div>
                <div class="hist-chips">
                  <button
                    v-for="t in hotTags"
                    :key="t.name"
                    class="tag-term"
                    type="button"
                    :title="`打开标签「${t.name}」的悬浮窗（${t.count}）`"
                    @click="openTagWorks(t.name)"
                  >{{ t.name }}<span class="tag-count">{{ t.count }}</span></button>
                </div>
              </div>
              <p v-else class="hint">输入标签关键词开始搜索</p>
            </template>
            <template v-else-if="searchHistory.length || recentSubjects.length">
              <div v-if="searchHistory.length" class="start-block">
                <div class="start-head">
                  <span>搜索历史</span>
                  <button class="start-clear" type="button" @click="clearSearchHistory()">清空</button>
                </div>
                <div class="hist-chips">
                  <span v-for="t in searchHistory" :key="t" class="hist-chip">
                    <button class="hist-term" type="button" :title="`搜索「${t}」`" @click="applyHistoryTerm(t)">{{ t }}</button>
                    <button class="hist-x" type="button" title="删除该记录" @click="dropHistoryTerm(t)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                    </button>
                  </span>
                </div>
              </div>
              <div v-if="recentSubjects.length" class="start-block">
                <div class="start-head">
                  <span>最近打开</span>
                  <button class="start-clear" type="button" @click="clearRecentSubjects()">清空</button>
                </div>
                <div class="recent-row">
                  <button
                    v-for="s in recentSubjects"
                    :key="s.id"
                    class="recent-item"
                    type="button"
                    :title="s.title"
                    @click="entity.openInstant('subject', s.id)"
                  >
                    <img v-if="s.image" :src="proxyImg(s.image)" :class="{ 'cover-blur': !settings.showNsfw && (s.nsfw || recentNsfw[s.id]) }" :alt="s.title" loading="lazy" />
                    <span v-else class="recent-empty">无封面</span>
                    <span class="recent-title">{{ s.title }}</span>
                  </button>
                </div>
              </div>
            </template>
            <p v-else class="hint">输入关键词开始搜索</p>
          </div>
          <!-- 标签模式：搜索结果 = 匹配的标签候选（点击打开该标签的作品悬浮窗） -->
          <div v-else-if="domain === 'tag' && tagResults.length" class="ph ph--start">
            <div class="start-block">
              <div class="start-head"><span>匹配的标签</span></div>
              <div class="hist-chips">
                <button
                  v-for="t in tagResults"
                  :key="t.name"
                  class="tag-term"
                  type="button"
                  :title="`打开标签「${t.name}」的悬浮窗（${t.count}）`"
                  @click="openTagWorks(t.name)"
                >{{ t.name }}<span class="tag-count">{{ t.count }}</span></button>
              </div>
            </div>
          </div>
          <div v-else-if="results.length === 0" class="ph">
            {{ domain === 'tag' ? `没有找到标签「${kw.trim()}」相关的作品` : `没有找到与“${kw.trim()}”相关的结果` }}
          </div>

          <div v-else class="grid">
            <!-- 条目结果 -->
            <div v-for="r in pagedResults" :key="keyOf(r)" class="rcard" @click="onResultClick(r)">
              <template v-if="r.kind === 'subject'">
                <div class="r-avatar">
                  <img v-if="r.subject.imageUrl" :src="proxyImg(r.subject.imageUrl)" :class="{ 'cover-blur': !settings.showNsfw && r.subject.nsfw }" :alt="r.subject.title" />
                  <span v-else class="r-avatar--empty">无封面</span>
                </div>
                <div class="rtitle">{{ r.subject.titleCn || r.subject.title }}</div>
                <div class="rcard-foot">
                  <span class="cat-badge" :class="'cat-' + r.subject.category">{{ CAT_LABELS[r.subject.category] }}</span>
                  <ResultCollectButton :subject="r.subject" />
                </div>
              </template>

              <!-- 人物结果 -->
              <template v-else>
                <div class="r-avatar">
                  <img v-if="r.imageUrl" :src="proxyImg(r.imageUrl)" :alt="r.name" />
                  <span v-else class="r-avatar--empty">无头像</span>
                </div>
                <div class="rtitle">{{ r.name }}</div>
                <span class="cat-badge" :class="r.personKind === 'character' ? 'cat-character' : 'cat-person'">
                  {{ r.personKind === 'character' ? '虚拟' : '现实' }}
                </span>
              </template>
            </div>
          </div>
          <div v-if="!auth.status.loggedIn && domain === 'subject' && results.length" class="login-hint">
            当前未登录：搜索基于 Bangumi 公开接口，结果与登录一致（已全量分页）。登录后可同步你的收藏进度。
          </div>

          <!-- 分页条（随结果滚动，非固定底部） -->
          <div class="pager" v-if="totalPages > 1">
            <button class="pg-btn" type="button" :disabled="currentPage <= 1" @click="goPage(-1)">上一页</button>
            <span class="pg-info">第 {{ currentPage }} / {{ totalPages }} 页 · 共 {{ results.length }} 条</span>
            <button class="pg-btn" type="button" :disabled="currentPage >= totalPages" @click="goPage(1)">下一页</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  /* 暗化 + 模糊已由全局唯一 .modal-backdrop（App.vue）统一负责，这里只做透明点击层，
     避免各悬浮窗各自带 background 导致切换时暗化层搬移、把全局模糊层拖去重算而闪烁。 */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 8vh;
}
/* 当实体卡（角色/CV/作品）叠在搜索之上时：搜索遮罩转为透明基底（pointer-events 关掉，
   卡片内容由 v-show 隐藏），让实体卡干净地叠在上面；关闭实体卡后底层搜索自然显现。 */
.search-overlay.behind {
  pointer-events: none;
}
.search-card {
  width: calc(100% - 64px);
  max-width: 1000px;
  max-height: calc(100vh - 16vh);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}
/* 悬浮窗本体沉浸光感（设置 subjectCardGlow 独立控制）：整卡背景半透明 */
.search-card.glow-card {
  background: color-mix(in srgb, var(--bg-panel) calc(70% * var(--glass-k)), transparent);
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 0;
}
.search-bar {
  flex: 1;
  min-width: 0;
  height: 44px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  color: var(--text-dim);
  transition: border-color 0.15s ease;
}
.search-bar:focus-within {
  border-color: var(--accent-aux);
}
.search-bar svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.search-bar input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 16px;
  font-weight: 500;
}
.search-bar input::placeholder {
  color: var(--text-dim);
}
.search-bar .clear {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.search-bar .clear:hover {
  background: var(--bg-deep);
  color: var(--text);
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease, color 0.15s ease;
}
.close svg {
  width: 16px;
  height: 16px;
  display: block;
}
.close:hover {
  background: var(--accent);
  color: #fff;
}
.close:active {
  background: #ff3d77;
  color: #fff;
  transform: scale(0.94);
}

/* 一级分类 */
.cat-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 16px 0;
}
.cat-tabs button {
  flex: 1;
  padding: 8px 0;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cat-tabs button.active {
  background: var(--accent-aux);
  border-color: var(--accent-aux);
  color: #fff;
}

/* 二级分类 */
.cat-sub {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.cat-sub button {
  padding: 5px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cat-sub button:hover {
  color: var(--text);
  border-color: var(--text-dim);
}
.cat-sub button.active {
  background: color-mix(in srgb, var(--accent-aux) 14%, var(--bg-elev));
  border-color: var(--accent-aux);
  color: var(--text);
}

.results {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px;
  min-height: 160px;
  display: flex;
  flex-direction: column;
}
.ph {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-dim);
  padding: 28px 0;
  font-size: 14px;
}
.ph.hint {
  color: var(--text-dim);
}
.ph.err {
  color: #ff6b6b;
}
/* ===== 空关键词起始页：搜索历史 + 最近浏览 ===== */
.ph--start {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 18px;
  padding: 18px 6px;
}
.start-block .start-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-dim);
}
.start-clear {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}
.start-clear:hover {
  background: var(--bg-deep);
  color: var(--text);
}
.hist-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hist-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.hist-term {
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  padding: 5px 4px 5px 12px;
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-term:hover {
  color: var(--accent-2);
}
/* 标签搜索结果 / 热门标签：带边框框，激活（hover）用强调色 */
.tag-term {
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 13px;
  padding: 5px 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.tag-term:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.tag-count {
  margin-left: 5px;
  font-size: 11px;
  color: var(--text-dim);
}
.hist-x {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  padding: 5px 9px 5px 3px;
  display: inline-flex;
  align-items: center;
}
.hist-x svg {
  width: 11px;
  height: 11px;
}
.hist-x:hover {
  color: var(--err);
}
.recent-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.recent-item {
  flex: 0 0 84px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.recent-item img,
.recent-item .recent-empty {
  width: 84px;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--bg-deep);
  border: 1px solid var(--border-soft);
  transition: transform var(--dur) var(--ease-out), border-color var(--dur-fast);
}
.recent-item:hover img {
  transform: translateY(-2px);
  border-color: var(--accent-aux);
}
.recent-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-dim);
}
.recent-title {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.recent-item:hover .recent-title {
  color: var(--text);
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
  border-radius: var(--radius);
  padding: 8px 8px 6px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.15s;
}
.rcard:hover {
  transform: translateY(-2px);
  border-color: var(--accent-aux);
}
.rcard:active {
  border-color: color-mix(in srgb, var(--accent-aux) 75%, #000);
}
.rcard .r-avatar {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-sm);
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
  display: inline-block;
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}
.cat-badge.cat-anime {
  background: #5b9dff;
}
.cat-badge.cat-light_novel {
  background: #57c08d;
}
.cat-badge.cat-manga {
  background: #e0853e;
}
.cat-badge.cat-galgame {
  background: #b06fd8;
}
.cat-badge.cat-character {
  background: #d883b0;
}
.cat-badge.cat-person {
  background: #6fa8d8;
}
/* 分页条（位于可滚动结果区内部，随内容一起滚动，非固定底部） */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 8px 16px 2px;
  margin-top: 8px;
  flex-shrink: 0;
}
.pg-btn {
  padding: 6px 18px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  border-radius: var(--radius-sm);
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
.login-hint {
  margin: 0 14px 14px;
  padding: 8px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

/* 进入/离开：遮罩淡入淡出 + 卡片轻微上浮 */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s ease;
}
.overlay-enter-active .search-card,
.overlay-leave-active .search-card {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.overlay-enter-from .search-card,
.overlay-leave-to .search-card {
  transform: translateY(-14px) scale(0.98);
  opacity: 0;
}
</style>
