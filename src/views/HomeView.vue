<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import EpisodeGrid from '@/components/EpisodeGrid.vue'
import ProgressEditor from '@/components/ProgressEditor.vue'
import EllipsisTitle from '@/components/EllipsisTitle.vue'
import EmptyState from '@/components/EmptyState.vue'
import TrendingDrawer from '@/components/TrendingDrawer.vue'
import { dbClient } from '@/services/dbClient'
import { animeClient } from '@/services/animeClient'
import { collectionClient } from '@/services/collectionClient'
import { subjectClient } from '@/services/subjectClient'
import { useAuthStore } from '@/stores/auth'
import { useEntityCard } from '@/composables/useEntityCard'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { useCollectionModal } from '@/composables/useCollectionModal'
import { useContextMenu } from '@/composables/useContextMenu'
import { buildCardMenu } from '@/composables/useCardContextMenu'
import { useToast } from '@/composables/useToast'
import { parseAppError } from '@/utils/appError'
import { useGridResizeFlip } from '@/composables/useGridResizeFlip'
import type { AnimeDetail, EpisodeMarkPayload } from '@shared/types'
import type { EpisodeCell } from '@/components/EpisodeGrid.vue'

const { open: openSubject, isOpen: entityOpen } = useEntityCard()
const { open: openMenu } = useContextMenu()
const toast = useToast()
const auth = useAuthStore()

// 主页卡片右键菜单：快速改状态 / 在 Bangumi 打开 / 删除收藏（状态变化后周历同步刷新）
function onCardMenu(e: MouseEvent, c: HomeCard) {
  const category = activeTab.value // 'anime' | 'light_novel' | 'manga' 即 Category 子集
  openMenu(
    e,
    buildCardMenu(
      {
        providerSubjectId: c.providerSubjectId,
        collectionId: c.collectionId,
        status: c.status,
        category,
        title: c.titleCn || c.title
      },
      {
        onChanged: () => {
          void loadTab(activeTab.value)
        }
      }
    )
  )
}

// 主页卡片在窗口缩放/侧栏收起跨列数断点时平滑过渡（与动画列表一致）。
// 由 useGridResizeFlip 统一驱动：卡片「位置平移 + 宽度渐变」按同一节奏同步
// （直接设置卡片 inline width 逐帧追向自然列宽，而非 transform:scale）→
// 封面/标题/格子字号等内部内容像素尺寸恒定、不随动画放大缩小/变形，且宽度与位置完全匹配。
// 观察 .home（始终存在、其宽度变化驱动 auto-fill 列数），而非可能延迟渲染的 .home-cards，
// 避免首屏卡片异步加载时 ResizeObserver 容器为 null 而挂不上、导致“无动画”。
// 尊重 prefers-reduced-motion（系统“减少动态效果”时自动禁用动画）。
useGridResizeFlip({
  containerSelector: '.home',
  cardSelector: '.hcard',
})

// —— 主页三个子分类 ——
type CatKey = 'anime' | 'light_novel' | 'manga'
const tabs: { key: CatKey; label: string }[] = [
  { key: 'anime', label: '动画' },
  { key: 'light_novel', label: '小说' },
  { key: 'manga', label: '漫画' }
]
const activeTab = ref<CatKey>('anime')

// —— 作品卡片数据 ——
interface HomeCard {
  collectionId: number
  subjectId: number
  title: string
  titleCn: string
  image: string | null
  status: number
  rating: number | null
  totalEpisodes: number | null
  totalVolumes: number | null
  series?: boolean | null // 书籍系列标志：false=单行本(无卷) true=丛书(有卷) null=未获取
  providerSubjectId?: string
  epCells?: EpisodeCell[] // 动画：集数格子
  epStatus?: number // 小说/漫画：已读话(章)
  volStatus?: number // 小说/漫画：已读卷
}

const cards = ref<HomeCard[]>([])
const loading = ref(false)

// 由 AnimeDetail 派生集数格子（与动画详情页完全一致，含真实集号/已看/想看/播出着色）
function buildEpCells(d: AnimeDetail): EpisodeCell[] {
  const local = d.episodes ?? []
  const bgm = d.bangumiEpisodes ?? []
  const prog = d.progress ?? {}
  if (bgm.length === 0) {
    return local.map((e) => ({
      id: e.id,
      epNumber: e.ep_number,
      watched: !!prog[e.id]?.watched,
      want: !!prog[e.id]?.want,
      dropped: !!prog[e.id]?.dropped,
      title: e.title ?? null,
      airDate: null,
      duration: null
    }))
  }
  const localByNum = new Map<number, { id: number; ep_number: number; title?: string | null }>()
  for (const e of local) localByNum.set(e.ep_number, e)
  return bgm.map((b) => {
    const l = localByNum.get(b.epNumber)
    const w = prog[b.id]?.watched ?? (l ? prog[l.id]?.watched : false)
    const wn = prog[b.id]?.want ?? (l ? prog[l.id]?.want : false)
    const dr = prog[b.id]?.dropped ?? (l ? prog[l.id]?.dropped : false)
    return {
      id: b.id,
      epNumber: b.epNumber,
      watched: !!w,
      want: !!wn,
      dropped: !!dr,
      title: b.title ?? null,
      airDate: b.airDate ?? null,
      duration: b.duration ?? null,
      epType: b.epType ?? 0
    }
  })
}

// 并发受限的 map（避免一次性发起数百个 IPC）
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function loadTab(cat: CatKey) {
  loading.value = true
  try {
    const rows = await dbClient.query<{
      collectionId: number
      subjectId: number
      title: string
      titleCn: string | null
      image: string | null
      status: number
      rating: number | null
      totalEpisodes: number | null
      totalVolumes: number | null
      series: number | null
      providerSubjectId: string | null
      epStatus: number
      volStatus: number
    }>(
      `SELECT c.id AS collectionId, s.id AS subjectId, s.title AS title, s.title_cn AS titleCn, s.image_url AS image,
              s.total_episodes AS totalEpisodes, s.total_volumes AS totalVolumes, s.series AS series,
              s.provider_subject_id AS providerSubjectId,
              c.status AS status, c.rating AS rating, c.ep_status AS epStatus, c.vol_status AS volStatus
       FROM collections c JOIN subjects s ON s.id = c.subject_id
       WHERE s.category = ? AND s.provider = 'bangumi' AND c.status = 3
       ORDER BY c.local_updated_at DESC`,
      [cat]
    )
    const base: HomeCard[] = rows.map((r) => ({
      collectionId: r.collectionId,
      subjectId: r.subjectId,
      title: r.title,
      titleCn: r.titleCn ?? '',
      image: r.image,
      status: r.status,
      rating: r.rating,
      totalEpisodes: r.totalEpisodes,
      totalVolumes: r.totalVolumes,
      series: r.series == null ? null : !!r.series,
      providerSubjectId: r.providerSubjectId ?? undefined,
      epStatus: r.epStatus,
      volStatus: r.volStatus
    }))

    if (cat === 'anime') {
      // 动画：一次批量 IPC 拉取全部本地详情（含真实剧集骨架 + 逐集进度），构建集数格子。
      // 相比逐卡 invoke（N 次 IPC 往返），首屏显著提速；批量失败时回退逐条拉取兜底。
      try {
        const details = await animeClient.getDetailsLocal(base.map((b) => b.subjectId))
        cards.value = base.map((b, i) => ({ ...b, epCells: buildEpCells(details[i]) }))
      } catch (e) {
        console.warn('[HomeView] 批量详情加载失败，回退逐条拉取', e)
        const detailed = await mapLimit(base, 8, async (card) => {
          const d = await animeClient.getDetailLocal(card.subjectId)
          return { ...card, epCells: buildEpCells(d) }
        })
        cards.value = detailed
      }
    } else {
      cards.value = base
    }
    // 后台从 Bangumi 强制拉取最新单集标记（force+reconcile，与详情页打开时同口径），
    // 拉到即就地更新格子着色——网页/其它端标的进度进主页也能看到
    void refreshRemoteProgress(cards.value)
  } finally {
    loading.value = false
  }
}

// 逐卡强制拉取 Bangumi 单集标记并就地合并（并发 8；失败静默跳过，不影响本地数据）。
// 合并发生实际变化的卡：① 置顶到列表最前（最后标记排最前）；② 回写 local_updated_at
// 保持下次全量加载的排序一致。仅动排序时间戳，不标 dirty（远端已是权威，无需上传）。
async function refreshRemoteProgress(list: HomeCard[]) {
  if (!auth.status.loggedIn) return // 未登录：无远端可拉，避免匿名请求打限流
  const targets = list.filter(
    (c) => c.providerSubjectId && /^\d+$/.test(String(c.providerSubjectId))
  )
  if (!targets.length) return
  const bumps: Promise<unknown>[] = []
  await mapLimit(targets, 8, async (c) => {
    try {
      const res = await subjectClient.pullEpisodeProgress(String(c.providerSubjectId), {
        force: true,
        reconcile: true
      })
      const prog = res.progress as Record<
        number,
        { watched?: boolean; want?: boolean; dropped?: boolean }
      >
      if (!c.epCells || !prog || Object.keys(prog).length === 0) return
      let changed = false
      let watchedCount = 0
      for (const cell of c.epCells) {
        const p = prog[cell.id]
        if (!p) continue
        if (cell.id > 0 && cell.watched) watchedCount++
        if (
          cell.watched !== !!p.watched ||
          cell.want !== !!p.want ||
          cell.dropped !== !!p.dropped
        ) {
          cell.watched = !!p.watched
          cell.want = !!p.want
          cell.dropped = !!p.dropped
          changed = true
          if (cell.id > 0 && cell.watched) watchedCount++
        }
      }
      // 自愈条件：格子有变化，或「本地收藏进度落后于已看格数」（上一版拉取只刷了
      // 格子着色、没动排序时间戳与 ep_status——这类历史欠账在此处一次性补齐，
      // 否则《花织》这类作品会永远埋在旧位置）
      const staleProgress =
        c.epStatus != null && watchedCount > (c.epStatus ?? 0)
      if ((changed || staleProgress) && c.collectionId != null) {
        // 排序时间戳 + ep_status 自愈（MAX 防止把网页端更高进度覆盖回去）；
        // 不标 dirty：这些字段远端已权威，纯本地镜像与排序用途
        bumps.push(
          dbClient
            .run(
              `UPDATE collections SET local_updated_at = strftime('%s','now'),
                 ep_status = MAX(COALESCE(ep_status,0), ?)
               WHERE id = ?`,
              [watchedCount, c.collectionId]
            )
            .catch(() => {})
        )
        if (staleProgress) c.epStatus = Math.max(c.epStatus ?? 0, watchedCount)
      }
    } catch {
      /* 离线/未登录/限流：跳过该卡，保留本地状态 */
    }
  })
  // 等时间戳/ep_status 自愈写库完成，再做确定性重排（避免读到旧值）
  await Promise.all(bumps)
  // —— 确定性兜底重排：直接按数据库真实时间戳对当前卡片降序排列，不依赖逐格变化检测 ——
  try {
    const ids = cards.value.map((x) => x.collectionId).filter((x): x is number => x != null)
    if (ids.length) {
      const rows = await dbClient.query<{ id: number; ts: number }>(
        `SELECT id, local_updated_at AS ts FROM collections WHERE id IN (${ids
          .map(() => '?')
          .join(',')})`,
        ids
      )
      const tsMap = new Map(rows.map((r) => [r.id, Number(r.ts) || 0]))
      cards.value = [...cards.value].sort(
        (a, b) => (tsMap.get(b.collectionId) ?? 0) - (tsMap.get(a.collectionId) ?? 0)
      )
    }
  } catch {
    /* 重排失败不影响已更新的着色 */
  }
}

watch(activeTab, (c) => loadTab(c), { immediate: false })

// —— 数据新鲜度：主页常驻挂载期间，悬浮窗/弹窗里的标记不会触发路由重载 ——
// 监听三类信号，任一发生即重拉当前分类数据：
// ① 实体卡（作品悬浮窗）从开→关（里面可能标记了单集/改了收藏）
// ② 搜索浮层从开→关（结果卡里可收藏）
// ③ 收藏数据变更 tick（收藏悬浮窗保存/删除、右键菜单等会 bump）
const entityOpenRef = entityOpen
const searchOv = useSearchOverlay()
const colModal = useCollectionModal()
watch([entityOpenRef, searchOv.isOpen], ([a, b], [pa, pb]) => {
  const closed = (pa && !a) || (pb && !b)
  if (closed) {
    void loadTab(activeTab.value).then(() => refreshRemoteProgress(cards.value))
  }
})
watch(colModal.refreshTick, () => {
  void loadTab(activeTab.value).then(() => refreshRemoteProgress(cards.value))
})

const displayCards = computed(() => cards.value)
// 打开作品悬浮窗：useEntityCard(subject) 与 SubjectCard 约定 id 为 Bangumi provider subject id
// （subject:detailLocal 走 isProvider=true，按 provider_subject_id 反查），故此处必须传 providerSubjectId，
// 不能传本地 subjects.id——否则会被误当成 provider id 反查出「另一部作品」。
function openCard(card: HomeCard) {
  const pid = card.providerSubjectId
  if (!pid) return
  openSubject('subject', Number(pid))
}
// 主页就地标记单集进度：更新本地 + 刷新格子着色，并**立即触发 pushAll**
// （把 dirty 的收藏行 ep_status 等推到 Bangumi——单集标记本身已在 IPC 内直传，
//  这里补齐收藏层；定时上传已改为每天一次，不能依赖）。
async function onMark(card: HomeCard, payload: EpisodeMarkPayload) {
  if (card.collectionId == null) {
    toast.err('该作品尚未加入收藏，无法标记')
    return
  }
  try {
    const { progress, epStatus } = await animeClient.setEpisodeStatus(card.collectionId, payload)
    const prog = progress as Record<number, { watched: boolean; want: boolean; dropped?: boolean }>
    if (card.epCells) {
      for (const cell of card.epCells) {
        const p = prog[cell.id]
        if (p) {
          cell.watched = !!p.watched
          cell.want = !!p.want
          cell.dropped = !!p.dropped
        }
      }
    }
    card.epStatus = epStatus
    // 即时上传：把收藏级变更（ep_status 等）同步到 Bangumi（fire-and-forget）
    void window.acgn.sync.pushAll().catch(() => {})
  } catch (e) {
    toast.err(parseAppError(e, '标记失败').message)
    console.warn('[HomeView] 标记单集进度失败', e)
  }
}

function pushHomeProgress() {
  void window.acgn.sync.pushAll().catch(() => {})
}
async function onHomeProgressEp(card: HomeCard, value: number) {
  if (card.collectionId == null) return
  try {
    const { epStatus } = await collectionClient.setProgress(card.collectionId, value, 'ep')
    card.epStatus = epStatus
    pushHomeProgress()
  } catch (e) {
    toast.err(parseAppError(e, '进度保存失败').message)
    console.warn('[HomeView] 更新已读话失败', e)
  }
}
async function onHomeProgressVol(card: HomeCard, value: number) {
  if (card.collectionId == null) return
  try {
    const { volStatus } = await collectionClient.setProgress(card.collectionId, value, 'vol')
    card.volStatus = volStatus
    pushHomeProgress()
  } catch (e) {
    toast.err(parseAppError(e, '进度保存失败').message)
    console.warn('[HomeView] 更新已读卷失败', e)
  }
}

// 防误触：同一作品 10s 内眼睛按钮只生效一次（key = collectionId）
const eyeCooldown = new Map<number, number>()

// 动画卡片封面眼睛按钮用：找到「最早没看过的集」（按 epNumber 升序第一个 id>0 且未看）
function nextUnwatched(card: HomeCard): EpisodeCell | null {
  const list = (card.epCells ?? []).filter((e) => e.id > 0 && !e.watched)
  if (list.length === 0) return null
  list.sort((a, b) => Number(a.epNumber) - Number(b.epNumber))
  return list[0]
}
// 点击眼睛：把最早没看过的那一集标记为看过（即把观看进度推进一集）。
// 复用 onMark（仅更新本地 + 刷新格子着色与 epStatus，上传交给定时同步），与格子内点按钮行为一致。
// 同作品 10s 冷却：避免误触连点导致一次推进多集。
async function markNextEpisode(card: HomeCard) {
  if (card.collectionId == null) return
  const now = Date.now()
  const last = eyeCooldown.get(card.collectionId) ?? 0
  if (now - last < 10000) return // 10s 内同作品仅触发一次
  eyeCooldown.set(card.collectionId, now)
  const ep = nextUnwatched(card)
  if (!ep) return
  await onMark(card, { action: 'watched', episodeId: ep.id })
}

onMounted(() => {
  // 先确认登录态（决定远端拉取是否启用），再载入当前分类
  void auth
    .refresh()
    .catch(() => {})
    .then(() => loadTab(activeTab.value))
  startLiveRefresh()
})

// —— 实时性：停留在主页期间，网页端新标记也能出现 ——
// ① 每 60s 轮询一次远端单集标记（仅动画 tab、登录态、窗口可见时）
// ② 从其它窗口/浏览器切回应用瞬间立即拉取一次
let liveTimer: number | null = null
function startLiveRefresh() {
  if (liveTimer !== null) return
  liveTimer = window.setInterval(() => {
    if (document.hidden || activeTab.value !== 'anime' || loading.value) return
    void refreshRemoteProgress(cards.value)
  }, 60000)
}
function onVisChange() {
  if (document.hidden || !auth.status.loggedIn || activeTab.value !== 'anime') return
  void refreshRemoteProgress(cards.value)
}
document.addEventListener('visibilitychange', onVisChange)

onUnmounted(() => {
  if (liveTimer !== null) clearInterval(liveTimer)
  document.removeEventListener('visibilitychange', onVisChange)
})
</script>

<template>
  <div class="home">
    <!-- 三个子分类（仅显示在看/在读的在追作品） -->
    <div class="subtabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="subtab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- 卡片区：首次加载显示骨架屏；切换分类时保留旧内容并轻微降透明（不闪烁） -->
    <div v-if="loading && cards.length === 0" class="home-cards" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="hcard skel-card">
        <div class="hcard-inner">
          <div class="hcard-cover skeleton"></div>
          <div class="hcard-body">
            <div class="skeleton sk-line" style="width: 72%"></div>
            <div class="skeleton sk-block"></div>
          </div>
        </div>
      </div>
    </div>
    <EmptyState
      v-else-if="!loading && displayCards.length === 0"
      text="还没有在看 / 在读的作品"
      hint="先去对应栏目把作品标记为「在看」，就会出现在这里"
    />
    <div v-else class="home-cards" :class="{ 'is-switching': loading }">
      <div
        v-for="c in displayCards"
        :key="c.subjectId"
        class="hcard"
        role="button"
        tabindex="0"
        :aria-label="`打开「${c.titleCn || c.title}」`"
        @click="openCard(c)"
        @keydown.enter.prevent="openCard(c)"
        @keydown.space.prevent="openCard(c)"
        @contextmenu.prevent="onCardMenu($event, c)"
      >
        <div class="hcard-inner">
        <div class="hcard-cover">
          <CoverImage :src="c.image" :alt="c.titleCn || c.title" />
          <button
            v-if="activeTab === 'anime' && nextUnwatched(c)"
            class="cover-eye"
            type="button"
            title="标记最早未看的一集为看过"
            aria-label="标记最早未看的一集为看过"
            @click.stop.prevent="markNextEpisode(c)"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        <div class="hcard-body">
          <!-- 标题：单行省略，悬停显示完整内容（EllipsisTitle 自带溢出检测 + tooltip） -->
          <EllipsisTitle class="hcard-title" :text="c.titleCn || c.title" />

          <!-- 动画：集数格子（可标记进度；点击单格打开单集评论悬浮窗） -->
          <div v-if="activeTab === 'anime' && c.epCells" class="hcard-grid" @click.stop>
            <EpisodeGrid
              :episodes="c.epCells"
              :total="c.totalEpisodes"
              :category="'anime'"
              :subject-id="c.providerSubjectId"
              @mark="onMark(c, $event)"
            />
          </div>

          <!-- 小说 / 漫画：已读话(章) + 已读卷 进度（与详情页一致，使用 ProgressEditor 可编辑） -->
          <template v-else>
            <div class="home-prog-row">
              <ProgressEditor
                :label="activeTab === 'manga' ? '已读话' : '已读章'"
                :value="c.epStatus ?? 0"
                :total="c.totalEpisodes"
                @update="(v) => onHomeProgressEp(c, v)"
                @click.stop
              />
              <button
                class="prog-plus"
                type="button"
                title="已读 +1"
                @click.stop="onHomeProgressEp(c, (c.epStatus ?? 0) + 1)"
              >+</button>
            </div>
            <div v-if="c.series !== false" class="home-prog-row">
              <ProgressEditor
                label="已读卷"
                :value="c.volStatus ?? 0"
                :total="c.totalVolumes"
                @update="(v) => onHomeProgressVol(c, v)"
                @click.stop
              />
              <button
                class="prog-plus"
                type="button"
                title="已读 +1"
                @click.stop="onHomeProgressVol(c, (c.volStatus ?? 0) + 1)"
              >+</button>
            </div>
          </template>
        </div>
        </div>
      </div>
    </div>

    <!-- 右侧热门讨论抽屉：点击右缘手柄向左展开（覆盖式，不挤压卡片网格） -->
    <TrendingDrawer />
  </div>
</template>

<style scoped>
.home {
  padding: 0 0 40px;
  max-width: none;
  /* 整体上移 15px（仅主页）：负 margin-top 落在 .content 的 26px 顶部内边距内，不被裁切 */
  margin: -15px auto 0;
}

.subtabs {
  display: flex;
  gap: 6px;
  margin: 5px 0 16px;
  border-bottom: 1px solid var(--border);
}
.subtab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 600;
  padding: 10px 16px;
  cursor: pointer;
  border-radius: 10px 10px 0 0;
  position: relative;
  transition: color 0.15s ease, background 0.15s ease;
}
.subtab:hover {
  color: var(--text);
  background: var(--bg-elev);
}
.subtab.active {
  color: var(--accent);
}
.subtab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}

/* 首次加载骨架卡：与真实 hcard 同构，避免加载完成时布局跳动 */
.skel-card {
  pointer-events: none;
  height: 132px;
}
.skel-card .hcard-cover {
  border-radius: 8px;
}
.hcard-body .sk-line {
  height: 14px;
  margin: 2px 0 6px;
}
.hcard-body .sk-block {
  flex: 1;
  min-height: 58px;
}
/* 切换分类时保留旧内容、轻微降透明过渡（不闪白） */
.home-cards {
  transition: opacity var(--dur) ease;
}
.home-cards.is-switching {
  opacity: 0.45;
  pointer-events: none;
}

/* 自适应排布：auto-fill + minmax 连续自适应，且「至少 2 列」。
   minmax(min(360px, calc(50% - 8px)), 1fr)：下限取「360px」与「容器一半减半个 gap」
   的较小者——容器 ≥ 736px 时按 360px 逐列增列（连续自适应）；容器 < 736px 时
   下限 = calc(50% - 8px)，2×(50%-8px)+16px = 100%，永远放得下 2 列 → 永不退化单列。
   列数增减的平滑过渡由 useGridResizeFlip 负责：卡片「位置平移 + 宽度渐变」按同一节奏同步（直接设 inline width，
   非 transform:scale）→ 封面/内部格子/标题字号保持各自自然像素尺寸、绝不随动画放大缩小/变形，且宽度与位置完全匹配。 */
.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(360px, calc(50% - 8px)), 1fr));
  gap: 16px;
  /* 换列动画中卡片可能被 transform 临时平移出界，裁掉溢出避免横向滚动条；
     非动画态 1fr 占满，clip 无副作用。 */
  overflow-x: clip;
}

.hcard {
  display: flex;
  padding: 12px;
  min-width: 0;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-panel);
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.hcard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
  border-color: var(--accent-2);
}
/* 内层包裹：封面 + 正文的 flex 行容器（封面 flex-shrink:0 固定、正文 flex:1 随卡片变宽）。
   窗口缩放/侧栏收起换列由 useGridResizeFlip 的「位置平移 + 宽度渐变」驱动（直接设卡片 inline width，
   非 transform:scale）→ 此层仅作普通布局容器，内部内容像素尺寸恒定、不变形。 */
.hcard-inner {
  flex: 1;
  display: flex;
  gap: 12px;
  min-width: 0;
  align-items: stretch;
}
.hcard-cover {
  position: relative;
  height: 86px;
  aspect-ratio: 3 / 4;
  flex-shrink: 0;
  align-self: flex-start;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elev);
}
/* 封面右下角眼睛按钮：默认隐藏，鼠标靠近（hover）整卡时才浮现；
   仅动画卡片且存在「未看的最早一集」时出现；点击把该集标为看过 */
.cover-eye {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 23px;
  height: 23px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
  z-index: 2;
}
.hcard:hover .cover-eye {
  opacity: 1;
  transform: scale(1);
}
.cover-eye:hover {
  background: rgba(15, 23, 42, 0.78);
  color: #2f80ed;
}
.hcard-cover :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hcard-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 主页小说/漫画卡片：已读话(章)/已读卷 两行间距收紧 + 整块缩到 80%。
   全局 .progress-editor 默认 margin:12px 0，配合 .hcard-body 的 gap(4px) 两行间达 ~28px；
   主页内改为 2px 使行距收到 ~8px。内部样式全是固定 px，故按比例重写到 0.8 倍，
   布局盒真的变小（行距不反弹），且不影响详情页全局样式。 */
.hcard-body :deep(.progress-editor) {
  margin: 2px 0;
  font-size: 10.4px; /* 13 * 0.8 */
  gap: 8px;          /* 10 * 0.8 */
}
.hcard-body :deep(.progress-editor input[type='number']) {
  width: 51px;        /* 64 * 0.8 */
  padding: 4.6px 4.8px; /* 原 5.6，上下各减 1px 共降 2px */
  font-size: 11.2px;  /* 14 * 0.8 */
  -moz-appearance: textfield; /* Firefox 隐藏上下箭头 */
  appearance: textfield;
}
/* 隐藏 number 输入框的上下微调箭头（Webkit：Chrome/Edge/Safari） */
.hcard-body :deep(.progress-editor input[type='number']::-webkit-inner-spin-button),
.hcard-body :deep(.progress-editor input[type='number']::-webkit-outer-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}
/* 主页进度行：ProgressEditor + 右侧「+1」加号按钮 */
.home-prog-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.prog-plus {
  flex: 0 0 auto;
  width: 17.6px;
  height: 17.6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.prog-plus:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.prog-plus:active {
  transform: scale(0.92);
}
.hcard-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
  /* 单行省略 + 悬停 tooltip 由 EllipsisTitle 组件内部实现 */
}
/* 集数格子区：阻止点击冒泡到整卡（避免打开作品卡）；格子自身点击/标记保持独立 */
.hcard-grid {
  cursor: default;
}
/* 主页卡片内集数格子：最多显示两行（29*2+5=63px），超出部分内部滚动，
   不撑高卡片 → 封面严格只对应两行、底部与第 2 行格子齐平 */
.hcard-grid :deep(.episode-block) {
  margin-top: 2px;
}
.hcard-grid :deep(.episode-grid) {
  grid-template-columns: repeat(auto-fill, 29px);
  gap: 5px;
}
.hcard-grid :deep(.ep-cell) {
  width: 29px;
  height: 29px;
  font-size: 11px;
}
/* 主页 SP 分隔格文字：组件默认 14px，本应小 1px → 13px（仅主页，不影响详情页）；
   水平居中修正：组件写死的 x=18 是按 36px 格子算的，主页格子 29px 宽，
   文字中心需落在 14.5px 处，故左移 3.5px；仅平移文字，竖线保持原样 */
.hcard-grid :deep(.ep-sep-svg text) {
  font-size: 13px;
  transform: translateX(-3.5px);
}

/* 小说/漫画进度已改用全局 ProgressEditor（见 main.css .progress-editor），不再需要 .hprog */
</style>
