<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { SubjectFullDetail, SubjectCharacter, Subject, EpisodeMarkPayload, SubjectFullEpisode, GameGallery as GameGalleryData } from '@shared/types'
import { proxyImg } from '@/utils/imgProxy'
import { subjectClient } from '@/services/subjectClient'
import { animeClient } from '@/services/animeClient'
import { collectionClient } from '@/services/collectionClient'
import { useEntityCard } from '@/composables/useEntityCard'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { useRecent } from '@/composables/useRecent'
import { useSettingsStore } from '@/stores/settings'
import EpisodeGrid from '@/components/EpisodeGrid.vue'
import SubjectMetaPanel from '@/components/SubjectMetaPanel.vue'
import SubjectCharacters from '@/components/SubjectCharacters.vue'
import SubjectRelations from '@/components/SubjectRelations.vue'
import TucaoBox from '@/components/TucaoBox.vue'
import SubjectTopics from '@/components/SubjectTopics.vue'
import CollectionBar from '@/components/CollectionBar.vue'
import GameGallery from '@/components/GameGallery.vue'
import PurchaseInfo from '@/components/PurchaseInfo.vue'
import SynopsisBox from '@/components/SynopsisBox.vue'
import ProgressEditor from '@/components/ProgressEditor.vue'
import { useImagePreview } from '@/composables/useImagePreview'
import { apiClient } from '@/services/apiClient'
import { purchaseClient } from '@/services/purchaseClient'
const { openImage: openPoster } = useImagePreview()

// 注意：本组件现为「单一 overlay 容器」EntitySubjectCard 的内嵌 body（作品），
// 外层遮罩、层级(z-index)、Esc/背景点击关闭均由宿主统一管理，这里只负责面板内容。
// 与 EntityCard 共用同一导航栈（state.kind === 'subject' 时由本组件渲染）。
const { isOpen, state, close, push, back, navDir } = useEntityCard()
const { pushRecentSubject } = useRecent()
const settings = useSettingsStore()
const searchOverlay = useSearchOverlay()
// 当前卡片对应的 Bangumi 作品 id（本地窗口即可靠，不随联网详情替换而丢失 camel/snake 字段差异）
const providerId = computed(() => {
  const s = state.value
  return s && s.kind === 'subject' ? String(s.id) : ''
})
// 关闭按钮（X）：从搜索点进来的作品卡，点 X 应「连搜索一起关掉」回到主页，而非退回搜索。
// 直接调 searchOverlay.close()——若搜索此刻没开（从详情页打开的作品卡）则为无害空操作。
function closeAll() {
  close()
  searchOverlay.close()
}

// 作品悬浮窗内的关联作品 / 单行本点击：叠入卡片导航栈（而非跳网页），保留侧键前进/后退
function openSubject(id: number) {
  push('subject', id)
}

// 头部箭头：返回上一级（卡片导航栈上一层的角色/作品）。已在栈根（首个打开的作品）时
// back() 返回 false，则直接关闭卡片（回到背后的详情页），与详情页「返回」语义一致。
function goBack() {
  if (!back()) close()
}

// 作品卡滚动容器（.subject-body）的引用：用于记录/还原各作品在导航栈里的滚动位置。
// 因本组件由 KeepAlive 按 kind 缓存，作品→作品互跳时实例不重建、滚动容器是同一块 DOM，
// 故必须在切换时显式管理 scrollTop（否则新作品会继承上一个作品的滚动位置，停在「中间」）。
const bodyEl = ref<HTMLElement | null>(null)

// 用户滚动时把当前位置写回导航栈当前条目（state.value 即栈中当前 CardState 对象本身）。
function onBodyScroll() {
  if (state.value && bodyEl.value) state.value.scrollTop = bodyEl.value.scrollTop
}

// 内容加载完成后，按导航方向定位滚动条：
//  - 返回（back）→ 还原该作品上次停留的位置（state.scrollTop 由 onBodyScroll 记录）；
//  - 前向（打开/前进）→ 不再在此统一滚顶（否则会覆盖用户在联网加载完成前已滚动到的位置），
//    改由 load() 内的 scrollTopOnce 在「内容首次出现」时滚一次顶，之后同作品联网替换不滚。
async function applyScroll() {
  await nextTick()
  const el = bodyEl.value
  if (!el) return
  if (navDir.value === 'back') {
    const saved = state.value?.scrollTop
    el.scrollTop = saved != null ? saved : 0
  }
}

const detail = ref<SubjectFullDetail | null>(null)
// 当前「已显示」详情对应的 Bangumi 作品 id（provider id）。用于在卡片内互跳时判断：
// 要切换到的目标作品若与当前显示的不是同一个、且未在缓存中，则先清空 detail，
// 避免出现「先闪旧作品内容、过一会才变新作品」的错乱（见下方 watch）。
const shownProviderId = ref<number | null>(null)
// 按 Bangumi id 缓存「整卡快照」：除主体 detail 外，连同单集/收藏/画廊/购买/进度等辅助状态一起缓存，
// 使 KeepAlive 返回/切换同一作品时 整卡同步秒显（无需先清空再异步重填），消除回退闪烁。
type CardCollection = {
  id?: number
  status?: number
  rating?: number | null
  ep_status?: number
  vol_status?: number
}
interface CardSnapshot {
  detail: SubjectFullDetail
  cachedEpisodes: SubjectFullEpisode[]
  collection: CardCollection | null
  gallery: GameGalleryData | null
  galleryNote: string
  purchase: { platform: string; price: number; currency: string }
  progress: Record<number, { watched: boolean; want: boolean; dropped?: boolean }>
  collectionId: number | null
  editEpValue: number
  editVolValue: number
}
const detailCache = new Map<number, CardSnapshot>()
const loading = ref(false)
const error = ref('')

// 悬浮窗单集进度：本地收藏 id 与 逐集进度映射（episodeId -> {watched,want,dropped}）。
// 仅在实际标记单集时才建收藏（见 onMark），查看不自动建。
const collectionId = ref<number | null>(null)
const progress = ref<Record<number, { watched: boolean; want: boolean; dropped?: boolean }>>({})
// 本地收藏（含「我的评价」评分 + 漫画/轻小说进度），供 SubjectMetaPanel 点亮星星。
// 仅查看不自动建；首次编辑进度时会按需自动建（见 ensureCollectionForProgress）。
const collection = ref<{
  id?: number
  status?: number
  rating?: number | null
  ep_status?: number
  vol_status?: number
} | null>(null)

// 悬浮窗内漫画 / 轻小说的双进度（已读话(章) + 已读卷）编辑值
const editEpValue = ref(0)
const editVolValue = ref(0)

function syncCardProgressFromCollection() {
  editEpValue.value = collection.value?.ep_status ?? 0
  editVolValue.value = collection.value?.vol_status ?? 0
}

// 编辑进度时若尚未收藏，先自动建收藏（状态=在读），再返回其 id；否则直接取已有 id。
async function ensureCollectionForProgress(): Promise<number | null> {
  if (collection.value?.id != null) return collection.value.id
  if (!detail.value) return null
  try {
    const subject = toSubject(detail.value.subject)
    const { collectionId } = await collectionClient.add(subject, 3)
    collection.value = { ...(collection.value ?? {}), id: collectionId, status: 3 }
    return collectionId
  } catch (e) {
    console.warn('[SubjectCard] 自动建收藏失败', e)
    return null
  }
}

// 书籍进度变更后立即上传到 Bangumi（只推 dirty 收藏），不必等 5 分钟定时同步
function pushNow() {
  void window.acgn.sync.pushAll().catch(() => {})
}

async function onCardProgressEp(value: number) {
  const cid = await ensureCollectionForProgress()
  if (cid == null) return
  editEpValue.value = value
  const { epStatus } = await collectionClient.setProgress(cid, value, 'ep')
  if (collection.value) collection.value.ep_status = epStatus
  pushNow()
}

async function onCardProgressVol(value: number) {
  const cid = await ensureCollectionForProgress()
  if (cid == null) return
  editVolValue.value = value
  const { volStatus } = await collectionClient.setProgress(cid, value, 'vol')
  if (collection.value) collection.value.vol_status = volStatus
  pushNow()
}

// 本地缓存的剧集（瞬时、不联网）：悬浮窗打开时优先用，避免每次都等在线抓取才显示真实集号/标题。
// detailFull 在线返回后会覆盖为最新数据并写回缓存。
const cachedEpisodes = ref<SubjectFullEpisode[]>([])

// 把悬浮窗的 SubjectFullSubject（snake_case）映射为 Subject（camelCase），供 addToWatching 建收藏。
function toSubject(s: SubjectFullDetail['subject']): Subject {
  return {
    provider: s.provider,
    providerSubjectId: s.providerSubjectId,
    category: s.category,
    title: s.title,
    titleCn: s.title_cn || undefined,
    summary: s.summary || undefined,
    imageUrl: s.image_url || undefined,
    airDate: s.air_date ?? undefined,
    totalEpisodes: s.total_episodes ?? undefined,
    totalVolumes: s.total_volumes ?? undefined,
    rating: s.rating,
    ratingCount: s.ratingCount,
    ratingTotal: s.ratingTotal,
    tags: s.tags,
    meta: s.meta
  }
}

// 加载该作品本地收藏与逐集进度（若尚未加入收藏，返回空，不自动建）。
// 注意：直接传入 Bangumi provider subject id（= 卡片 id），不要从 detail.value.subject.providerSubjectId
// 反查——本地 detailLocal 返回的 subject 是数据库原始 snake_case 行（无 providerSubjectId 字段，
// 仅 provider_subject_id），会导致 getProgress 收到 undefined、进度全空；而 detailFull 的归一化
// camelCase 才有 providerSubjectId。显式传 id 可绕开该差异，且本地优先即时上色。
async function loadProgress(providerSubjectId: number) {
  const pid = String(providerSubjectId)
  if (!pid) return
  try {
    const res = await subjectClient.getProgress(pid)
    if (state.value?.kind !== 'subject' || state.value.id !== providerSubjectId) return
    collectionId.value = res.collectionId
    progress.value = res.progress
  } catch {
    if (state.value?.kind !== 'subject' || state.value.id !== providerSubjectId) return
    collectionId.value = null
    progress.value = {}
  }
  // 背景拉取 Bangumi 单集标记（已登录时）：本地优先即时显示，拉回后更新缓存与着色。
  // 未登录 / 失败 / 本地已有标记(走缓存) 时 pullEpisodeProgress 直接回退本地，不阻塞、不影响显示。
  void subjectClient
    .pullEpisodeProgress(pid)
    .then((pulled) => {
      if (
        pulled?.collectionId != null &&
        state.value?.kind === 'subject' &&
        state.value.id === providerSubjectId
      ) {
        collectionId.value = pulled.collectionId
        progress.value = pulled.progress
      }
    })
    .catch((e) => console.warn('[SubjectCard] 拉取 Bangumi 单集标记失败', e))
}

// 加载该作品本地收藏（含「我的评价」评分 + 漫画/轻小说进度），供 CollectionBar 点亮状态/星星。
// 仅查看不自动建；首次编辑进度时会按需自动建（见 ensureCollectionForProgress）。
// 带过期守卫：提前并行触发时若卡片已切换同一作品，则不误写。
async function loadCollection(id: number) {
  try {
    const ex = await collectionClient.getExisting(String(id))
    if (state.value?.id !== id) return
    collection.value = {
      id: ex.id ?? undefined,
      status: ex.status ?? undefined,
      rating: ex.rating ?? null,
      ep_status: ex.ep_status ?? 0,
      vol_status: ex.vol_status ?? 0
    }
    syncCardProgressFromCollection()
  } catch {
    collection.value = null
  }
}

// 游戏画廊（仅 Galgame 作品展示）：VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组
const gallery = ref<GameGalleryData | null>(null)
const galleryLoading = ref(false)
const galleryNote = ref('')

async function loadGallery(force: boolean) {
  if (detail.value?.subject.category !== 'galgame') return
  galleryLoading.value = true
  galleryNote.value = ''
  try {
    gallery.value = await apiClient.gallery(providerId.value, force)
    const total =
      (gallery.value?.vndb.length ?? 0) +
      (gallery.value?.dlsite.length ?? 0) +
      (gallery.value?.steam.length ?? 0)
    if (total === 0) {
      galleryNote.value = '该作暂无可显示的 CG / 截图（可能未在 Bangumi 维基登记对应外链）。'
    }
  } catch (e) {
    galleryNote.value = '抓取失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    galleryLoading.value = false
  }
}

// 购买信息（仅 Galgame 作品展示）：平台 + 价格，依附于本地收藏
const purchase = ref<{ platform: string; price: number; currency: string }>({
  platform: '',
  price: 0,
  currency: 'CNY'
})
const saveMsg = ref('')

async function loadPurchase() {
  const cid = collectionId.value
  if (cid == null) {
    purchase.value = { platform: '', price: 0, currency: 'CNY' }
    return
  }
  try {
    const p = await purchaseClient.get(cid)
    purchase.value = {
      platform: p?.platform ?? '',
      price: p?.price ?? 0,
      currency: p?.currency ?? 'CNY'
    }
  } catch {
    purchase.value = { platform: '', price: 0, currency: 'CNY' }
  }
}

async function savePurchase() {
  if (!detail.value) return
  // 未加入收藏时先建收藏再保存（购买信息依附于收藏）；已收藏则直接保存
  if (collectionId.value == null) {
    try {
      const subject = toSubject(detail.value.subject)
      const { collectionId: cid } = await collectionClient.add(subject)
      collectionId.value = cid
    } catch {
      saveMsg.value = '保存失败：无法建立收藏'
      return
    }
  }
  const rawPlatform = purchase.value.platform
  const platform = rawPlatform && rawPlatform !== '__other__' ? rawPlatform : undefined
  const saved = await purchaseClient.save(collectionId.value!, {
    platform,
    price: purchase.value.price || undefined,
    currency: purchase.value.currency || 'CNY'
  })
  purchase.value = {
    platform: saved.platform ?? '',
    price: saved.price ?? 0,
    currency: saved.currency ?? 'CNY'
  }
  saveMsg.value = '已保存到本地'
}

async function load() {
  const s = state.value
  if (!s || s.kind !== 'subject') return
  const id = s.id
  // 前向（打开/前进/点关联作品前进）时，仅在该作品内容【首次出现】时滚一次到顶部；
  // 同一作品后续的联网替换（local → full，id 不变）不再滚顶，以保留用户已滚动到的位置。
  // 返回（back）不在此滚顶，由下方 applyScroll 还原上次停留位置。
  const forward = navDir.value !== 'back'
  let initialScrolled = false
  const scrollTopOnce = async () => {
    if (!forward || initialScrolled) return
    initialScrolled = true
    await nextTick()
    if (bodyEl.value) bodyEl.value.scrollTop = 0
  }
  // 命中缓存：秒显主体（不 loading、不发详情网络请求），仅轻量补全本地进度/收藏/CG，
  // 避免 KeepAlive 返回/来回切换同一作品时重新经历「详情为空 → 联网加载」的矮态闪烁。
  const hit = detailCache.get(id)
  if (hit) {
    // 同步恢复整卡快照：主体 + 单集/收藏/画廊/购买/进度，立即秒显，无异步空态间隙（消除回退闪烁）。
    // 随后仍触发后台轻量 refresh（本地库，毫秒级）拿最新数据，用户在别处改过则静默覆盖。
    detail.value = hit.detail
    cachedEpisodes.value = hit.cachedEpisodes
    collection.value = hit.collection
    gallery.value = hit.gallery
    galleryNote.value = hit.galleryNote
    purchase.value = hit.purchase
    progress.value = hit.progress
    collectionId.value = hit.collectionId
    editEpValue.value = hit.editEpValue
    editVolValue.value = hit.editVolValue
    shownProviderId.value = id
    loading.value = false
    await scrollTopOnce()
    await loadProgress(id)
    try {
      const ex = await collectionClient.getExisting(String(id))
      collection.value = {
        id: ex.id ?? undefined,
        status: ex.status ?? undefined,
        rating: ex.rating ?? null,
        ep_status: ex.ep_status ?? 0,
        vol_status: ex.vol_status ?? 0
      }
      syncCardProgressFromCollection()
    } catch {
      collection.value = null
    }
    if (hit.detail.subject.category === 'galgame') {
      await loadGallery(false)
      await loadPurchase()
    }
    return
  }
  loading.value = true
  error.value = ''
  try {
    // 先读本地缓存的剧集（瞬时），悬浮窗立即显示真实集号/标题/首播/时长，不必等在线抓取
    try {
      cachedEpisodes.value = await subjectClient.getEpisodes(String(id))
    } catch {
      cachedEpisodes.value = []
    }
    // 本地优先：先取离线/缓存详情（含 Archive 站点均分、角色、关联），立即渲染、骨架屏消失；
    // Archive 缺失也无害——detailFull 联网后整体替换。已切换/关闭则丢弃本次结果。
    let local: SubjectFullDetail | null = null
    try {
      local = await subjectClient.detailLocal(id)
    } catch {
      local = null
    }
    if (local && local.subject && state.value?.id === id) {
      detail.value = local
      shownProviderId.value = id
      loading.value = false
      // 本地优先：集数进度（着色）+ 收藏（状态/评分点亮）立即并行加载——均为本地查库（毫秒级），
      // 与下方后台联网 detailFull 并行，避免格子先以「无进度」默认色渲染、等 1~2s 联网后才上色。
      void loadProgress(id)
      void loadCollection(id)
      await scrollTopOnce()
    }
    // 后台联网拉取完整详情（静默），回来后整体替换（评分原地更新）；已切换/关闭则丢弃
    const full = await subjectClient.detailFull(id, { withCn: false })
    if (state.value?.id === id) {
      // 防御：若在线结果偶发丢了评分（API 未返回 rating），保留本地 Archive 已秒显的评分，
      // 避免被整体替换成 null → 显示「暂无评分」。
      if (
        full?.subject &&
        detail.value?.subject &&
        full.subject.rating == null &&
        detail.value.subject.rating != null
      ) {
        full.subject = { ...full.subject, rating: detail.value.subject.rating }
      }
      detail.value = full
      if (full) {
        shownProviderId.value = id
        // 记录最近浏览（搜索浮层「最近打开」入口的数据源）：标题取中文优先
        const s = full.subject
        if (s) pushRecentSubject(id, s.title_cn || s.title || '', s.image_url ?? null)
      }
      await scrollTopOnce()
      // 本地缺详情（detailLocal 为空）导致上面未提前加载进度/收藏时，此处补加载（仍本地，秒级）
      if (!(local && local.subject)) {
        void loadProgress(id)
        void loadCollection(id)
      }
    }
    void refreshCn(id)
    // 游戏作品：载入 CG 画廊与本地购买信息
    if (detail.value?.subject.category === 'galgame') {
      await loadGallery(false)
      await loadPurchase()
    }
    // 整卡快照：含单集/收藏/画廊/购买/进度等辅助状态，供 KeepAlive 返回/切换同一作品时
    // 同步秒显整张卡（load() 命中分支整卡同步恢复），消除「先清空再异步填充」的回退闪烁。
    if (full) {
      detailCache.set(id, {
        detail: full,
        cachedEpisodes: cachedEpisodes.value,
        collection: collection.value,
        gallery: gallery.value,
        galleryNote: galleryNote.value,
        purchase: purchase.value,
        progress: progress.value,
        collectionId: collectionId.value,
        editEpValue: editEpValue.value,
        editVolValue: editVolValue.value
      })
    }
  } catch (e) {
    error.value = '加载失败：' + (e instanceof Error ? e.message : String(e))
    if (!detail.value) detail.value = null
  } finally {
    loading.value = false
  }
}

// 悬浮窗剧集格子数据：优先用在线 detail.episodes（最新），否则用本地缓存剧集（瞬时）；
// 叠加本地进度（已看/想看）着色。detail.episodes 与 cachedEpisodes 都是 SubjectFullEpisode[]。
const epCells = computed(() =>
  ((detail.value?.episodes?.length ? detail.value.episodes : cachedEpisodes.value) ?? []).map((e) => ({
    id: e.id,
    epNumber: e.epNumber,
    epType: e.epType ?? 0,
    watched: !!progress.value[e.id]?.watched,
    want: !!progress.value[e.id]?.want,
    dropped: !!progress.value[e.id]?.dropped,
    title: e.title,
    airDate: e.airDate,
    duration: e.duration
  }))
)

// 标记单集状态：首次标记自动建收藏（加入「在看」），之后复用同一 collectionId。
async function onMark(payload: EpisodeMarkPayload) {
  if (!detail.value) return
  try {
    if (!collectionId.value) {
      const subject = toSubject(detail.value.subject)
      const { collectionId: cid } = await animeClient.addToWatching(subject)
      collectionId.value = cid
    }
    const res = await animeClient.setEpisodeStatus(collectionId.value, payload)
    progress.value = res.progress
    // 即时上传：收藏级变更推到 Bangumi（单集标记已在 IPC 内直传）
    void window.acgn.sync.pushAll().catch(() => {})
  } catch (e) {
    console.warn('[SubjectCard] 标记单集失败', e)
  }
}

// 首屏渲染后异步补全角色/CV 中文名（避免阻塞悬浮窗打开；失败不影响主内容）。
// 带守卫：若用户在补齐完成前已切换/关闭，则丢弃本次结果，避免错位合并。
async function refreshCn(id: number) {
  if (!detail.value) return
  try {
    const chars = await subjectClient.getCharacters(id)
    const d = detail.value
    if (!d || d.subject.id !== id) return
    const byId = new Map<number, SubjectCharacter>(
      chars.map((c) => [c.id, c] as [number, SubjectCharacter])
    )
    const merged: SubjectCharacter[] = (d.characters || []).map((c) => {
      const up = byId.get(c.id)
      if (!up) return c
      return {
        ...c,
        nameCn: up.nameCn || c.nameCn,
        name: up.name || c.name,
        actors: (c.actors || []).map((a) => {
          const upa = (up.actors || []).find((x) => x.id === a.id)
          return upa ? { ...a, nameCn: upa.nameCn || a.nameCn, name: upa.name || a.name } : a
        })
      }
    })
    detail.value = { ...d, characters: merged }
  } catch {
    /* 中文名补全失败不影响主内容展示 */
  }
}

// 媒体类型（决定吐槽区收藏状态中文词：看/读/玩）
const mediaType = computed<'anime' | 'book' | 'manga' | 'game'>(() => {
  const c = detail.value?.subject.category
  if (c === 'anime') return 'anime'
  if (c === 'galgame') return 'game'
  if (c === 'light_novel') return 'book'
  return 'manga'
})

watch(
  () => [isOpen.value, state.value?.id, state.value?.kind],
  async () => {
    if (isOpen.value && state.value?.kind === 'subject') {
      const targetId = state.value.id
      const cached = detailCache.get(targetId)
      if (!cached) {
        // 尚未缓存的「新作品」：清空所有状态以显示占位，避免沿用上一个作品的数据（先闪旧内容、过会才变新）。
        // 返回/切换回【已缓存】作品时【不清空】——load() 命中缓存会同步恢复整卡快照，
        // 若此处先清空、再等异步 loadProgress/loadGallery 填充，反而会出现回退闪烁。
        detail.value = null
        cachedEpisodes.value = []
        collection.value = null
        progress.value = {}
        collectionId.value = null
        editEpValue.value = 0
        editVolValue.value = 0
        gallery.value = null
        galleryNote.value = ''
        purchase.value = { platform: '', price: 0, currency: 'CNY' }
        saveMsg.value = ''
      }
      await load()
      // 内容加载完毕后，按导航方向定位滚动条：返回 → 还原上次位置；前向滚顶由 load() 内
      // scrollTopOnce 在「内容首次出现」时处理（避免覆盖用户已滚动位置）。
      await applyScroll()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="subject-card" @click.stop>
    <div class="subject-head">
      <button class="entity-back back-btn" type="button" title="返回上级" aria-label="返回上级" @click="goBack">
        <svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg>
      </button>
      <span class="title">{{ detail?.subject.title_cn || detail?.subject.title || '作品详情' }}</span>
      <button class="close" type="button" title="关闭" aria-label="关闭" @click="closeAll">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 本地数据（detailLocal）一到即显示正文（v-else-if="detail"）；此占位仅在 detail 尚未就绪时
         出现，不再显示「加载中…」转圈/文字（对齐动画详情页的无提示秒显体验）。 -->
    <div v-if="!detail && !error" class="subject-body">
      <div class="ph"></div>
    </div>
    <div v-else-if="error" class="subject-body">
      <div class="ph err">{{ error }}</div>
    </div>

    <div v-else-if="detail" class="subject-body" ref="bodyEl" @scroll.passive="onBodyScroll">
      <!-- 封面横幅：与详情页同款（模糊放大的封面铺在头部作装饰，可在设置关闭） -->
      <div
        v-if="settings.detailBanner && detail.subject.image_url"
        class="detail-banner subject-banner"
        :style="{ backgroundImage: `url(${proxyImg(detail.subject.image_url)})` }"
      ></div>
      <!-- 头部：封面 + 标题 + 简介（复用全局 .detail__* 样式，与详情页一致） -->
      <div class="detail__main">
        <img v-if="detail.subject.image_url" :src="proxyImg(detail.subject.image_url)" class="detail__poster" :alt="detail.subject.title" @click.stop="openPoster(proxyImg(detail.subject.image_url), detail.subject.title)" style="cursor: pointer" />
        <span v-else class="detail__poster detail__poster--empty">无封面</span>
        <div class="detail__body">
          <h2>{{ detail.subject.title_cn || detail.subject.title }}</h2>
          <CollectionBar
            v-if="detail && providerId"
            :provider-subject-id="providerId"
            :category="detail.subject.category"
          />
          <!-- 漫画 / 轻小说：已读话(章) + 已读卷 双进度编辑（动画走剧集格子，游戏走购买信息） -->
          <template
            v-if="detail.subject.category === 'manga' || detail.subject.category === 'light_novel'"
          >
            <ProgressEditor
              :label="detail.subject.category === 'manga' ? '已读话' : '已读章'"
              :value="editEpValue"
              :total="detail.subject.total_episodes ?? null"
              @update="onCardProgressEp"
            />
            <ProgressEditor
              v-if="detail.subject.series != false"
              label="已读卷"
              :value="editVolValue"
              :total="detail.subject.total_volumes ?? null"
              @update="onCardProgressVol"
            />
          </template>
          <!-- 动画：中间插入剧集格子（真实剧集来自 Bangumi /episodes，含真实集号/标题/首播/时长；
               点击可选「看过/看到/想看/撤销」标记单集状态，标记同步到 Bangumi；
               格子按 看过/想看/今天或明天播出/已播未看/未播出 分色；获取失败则按 total_episodes 默认 12 格兜底） -->
          <EpisodeGrid
            v-if="detail.subject.category === 'anime'"
            :episodes="epCells"
            :total="detail.subject.total_episodes"
            :air-date="detail.subject.air_date"
            :subject-id="providerId"
            @mark="onMark"
          />
          <SynopsisBox v-if="detail.subject.summary" :text="detail.subject.summary" />
        </div>
      </div>

      <!-- 评分 / 标签 / 制作信息（悬浮窗内：制作信息人名跳转用 push 以支持侧键回退） -->
      <SubjectMetaPanel :subject="detail.subject" :collection="collection" :loading="false" :push-nav="true" />
      <!-- 游戏画廊（仅 Galgame 作品展示）：VNDB 截图 / DLsite 样例 / Steam 截图 -->
      <GameGallery
        v-if="detail.subject.category === 'galgame'"
        :gallery="gallery"
        :loading="galleryLoading"
        :note="galleryNote"
        @refresh="loadGallery(true)"
      />
      <!-- 角色 -->
      <SubjectCharacters :subject-id="detail.subject.id" :characters="detail.characters || []" :push-nav="true" />
      <!-- 关联条目：单行本 + 其它 -->
      <SubjectRelations :subject-id="detail.subject.id" :relations="detail.relations || []" filter="single" @select="openSubject" />
      <SubjectRelations :subject-id="detail.subject.id" :relations="detail.relations || []" filter="other" @select="openSubject" />
      <!-- 购买信息（仅 Galgame 作品展示，依附于本地收藏） -->
      <PurchaseInfo
        v-if="detail.subject.category === 'galgame'"
        v-model="purchase"
      >
        <template #actions>
          <button class="btn btn--accent btn--sm" @click="savePurchase">保存购买信息</button>
        </template>
      </PurchaseInfo>
      <p v-if="detail.subject.category === 'galgame' && saveMsg" class="ok">{{ saveMsg }}</p>
      <!-- 本作讨论（默认最新2条，可展开分页；点击弹出讨论板悬浮窗） -->
      <SubjectTopics :subject-id="providerId" />
      <!-- 吐槽区 -->
      <TucaoBox :subject-id="providerId" :media-type="mediaType" />
    </div>
  </div>
</template>

<style scoped>
.subject-card {
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
/* 关闭按钮：与搜索卡片 / 角色卡片的叉一致（34px 圆形、hover 高亮） */
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
/* 单栏滚动（作品卡内容纵向排布，共用一条滚动条） */
.subject-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 封面横幅的定位上下文（横幅随内容滚动，行为与详情页一致） */
  position: relative;
}
/* 悬浮窗内的横幅：抵消 .subject-body 的 16px 内边距铺满可视顶部，
   其余 blur/透明度/渐隐 mask 复用全局 .detail-banner */
.subject-banner {
  top: -16px;
  left: -16px;
  right: -16px;
  height: 360px;
}
.detail__poster--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-dim);
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
</style>
