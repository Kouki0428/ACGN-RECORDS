<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import EpisodeGrid from '@/components/EpisodeGrid.vue'
import TucaoBox from '@/components/TucaoBox.vue'
import SubjectTopics from '@/components/SubjectTopics.vue'
import CollectionBar from '@/components/CollectionBar.vue'
import SubjectMetaPanel from '@/components/SubjectMetaPanel.vue'
import SubjectCharacters from '@/components/SubjectCharacters.vue'
import SubjectRelations from '@/components/SubjectRelations.vue'
import StatusTabs from '@/components/StatusTabs.vue'
import CoverImage from '@/components/CoverImage.vue'
import SynopsisBox from '@/components/SynopsisBox.vue'
import EmptyState from '@/components/EmptyState.vue'
import DetailAnchors, { type AnchorItem } from '@/components/DetailAnchors.vue'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { useContextMenu } from '@/composables/useContextMenu'
import { buildCardMenu } from '@/composables/useCardContextMenu'
import { useSettingsStore } from '@/stores/settings'
import { proxyImg } from '@/utils/imgProxy'
import { animeClient } from '@/services/animeClient'
import { subjectClient } from '@/services/subjectClient'
import type { Subject, AnimeDetail, AnimeWatchingItem, EpisodeMarkPayload } from '@shared/types'
import { statusLabel } from '@/utils/statusLabels'
import { formatMarkedAt } from '@/utils/format'
import { useNavHistory } from '@/composables/useNavHistory'
import { useEntityCard } from '@/composables/useEntityCard'
import { scrollContentToTop, restoreContentScroll } from '@/utils/scroll'
import { useCollectionModal } from '@/composables/useCollectionModal'

// 关联作品 / 单行本点击：打开作品悬浮窗（而非跳网页）
const { open: openSubjectCard } = useEntityCard()
const { open: openSearch } = useSearchOverlay()
const { open: openMenu } = useContextMenu()
const settings = useSettingsStore()

// 详情页吸顶锚点（区块顺序与模板一致）
const anchors: AnchorItem[] = [
  { key: 'overview', label: '概览' },
  { key: 'characters', label: '角色' },
  { key: 'single', label: '单行本' },
  { key: 'relations', label: '关联条目' },
  { key: 'tucao', label: '吐槽' }
]

// 卡片右键菜单：快速改状态 / 在 Bangumi 打开 / 删除收藏
function onCardMenu(e: MouseEvent, w: AnimeWatchingItem) {
  openMenu(
    e,
    buildCardMenu(
      {
        providerSubjectId: w.providerSubjectId,
        collectionId: w.collectionId,
        status: w.status ?? activeStatus.value,
        category: 'anime',
        title: w.titleCn || w.title
      },
      { onChanged: refreshList }
    )
  )
}
function onSubjectSelect(id: number) {
  openSubjectCard('subject', id)
}

const watching = ref<AnimeWatchingItem[]>([])
const selected = ref<AnimeDetail | null>(null)
// 鼠标侧键「前进」重开目标：记录上次从详情退回列表时的作品（新导航会失效）
const lastDetail = ref<AnimeDetail | null>(null)

// 收藏悬浮窗保存（评分/状态/吐槽）后，刷新本详情页的收藏（含我的评价），使 SubjectMetaPanel 同步显示
const modal = useCollectionModal()
watch(
  () => modal.refreshTick.value,
  async () => {
    const id = selected.value?.subject?.id
    if (!id) return
    const fresh = await animeClient.getDetailLocal(id)
    const cur = selected.value
    if (!cur || cur.subject?.id !== fresh.subject?.id) return
    selected.value = { ...cur, collection: fresh.collection }
  }
)
const nav = useNavHistory()
const selectedEpisodeId = ref<number | null>(null)
const enriching = ref(false)
let stopSummary: (() => void) | undefined
let stopMeta: (() => void) | undefined

// 当前选中的收藏状态（Bangumi：3=在看 2=看过 1=想看 4=搁置 5=抛弃）
const activeStatus = ref<number>(3)
const currentLabel = computed(() => statusLabel('anime', activeStatus.value))

// 由详情派生：剧集网格（含已看/想看状态）。
// 以 Bangumi 真实剧集为骨架（真实集号/标题/首播/时长），进度键统一用 Bangumi 剧集 id
// （与悬浮窗一致，跨视图共享进度）；本地存在同集号剧集时回退本地 id 以兼容历史进度。
const gridEpisodes = computed(() => {
  if (!selected.value) return []
  const local = selected.value.episodes ?? []
  const bgm = selected.value.bangumiEpisodes ?? []
  const prog = selected.value.progress ?? {}
  // 无真实剧集：退回本地占位剧集（可点格子记进度）
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
  // 按真实集号匹配本地剧集（兼容历史进度键）
  const localByNum = new Map<number, any>()
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
})

async function refreshList() {
  watching.value = await animeClient.listWatching(activeStatus.value)
}

async function addToWatching(subject: Subject) {
  const { subjectId } = await animeClient.addToWatching(subject)
  await openDetail(subjectId)
  await refreshList()
}

async function openDetail(subjectId: number) {
  // 新导航使「前进」历史失效
  lastDetail.value = null
  // 本地优先：立即展示已缓存的评分/标签/制作信息与逐集进度（不等待联网）
  const local = await animeClient.getDetailLocal(subjectId)
  selected.value = local
  scrollContentToTop()
  selectedEpisodeId.value = null
  // 单集进度独立后台拉取：不依赖重型 getDetail（简介/角色/评分/剧集抓取可能很慢），
  // 拉到即更新进度着色，消除「在 Bangumi 网页/其它端标过的单集」打开详情时状态延迟。
  const pid = local.subject?.provider_subject_id
  if (pid) {
    subjectClient
      .pullEpisodeProgress(pid, { force: true, reconcile: true })
      .then((res) => {
        const cur = selected.value
        if (!cur || cur.subject?.id !== local.subject?.id) return
        // force 模式返回真实剧集骨架 + 单集进度（均按 Bangumi 真实集 id 键），一并套用即可即时显色；
        // 这样首次打开（本地剧集缓存为空、网格本是用占位 id）也能正确着色，无需等 getDetail 整包联网。
        if (res.episodes && res.episodes.length) cur.bangumiEpisodes = res.episodes
        cur.progress = res.progress
      })
      .catch(() => {})
  }
  // 后台联网补全：完成后再更新（仍在看同一作品才覆盖）
  enriching.value = true
  try {
    const full = await animeClient.getDetail(subjectId)
    if (selected.value?.subject?.id === full.subject?.id) {
      const prev = selected.value
      selected.value = full
      // 防御：若在线结果偶发丢了评分，保留本地 Archive 已秒显的评分，避免被整体替换成 null
      if (
        full.subject &&
        prev.subject &&
        full.subject.rating == null &&
        prev.subject.rating != null
      ) {
        selected.value.subject = { ...full.subject, rating: prev.subject.rating }
      }
      // 保留后台已拉到的单集进度 / 真实剧集骨架：若 getDetail 内部拉取失败（限流/无本地收藏）导致为空，
      // 用后台已拉到的结果兜底，避免被整包覆盖冲掉——这是「首次打开无状态」的根因。
      if (
        prev.progress &&
        Object.keys(prev.progress).length &&
        (!full.progress || Object.keys(full.progress).length === 0)
      ) {
        selected.value.progress = prev.progress
      }
      if (
        prev.bangumiEpisodes &&
        prev.bangumiEpisodes.length &&
        !full.bangumiEpisodes?.length
      ) {
        selected.value.bangumiEpisodes = prev.bangumiEpisodes
      }
    }
  } finally {
    enriching.value = false
  }
}

async function onMark(payload: EpisodeMarkPayload) {
  if (!selected.value?.collection) return
  selectedEpisodeId.value = payload.episodeId
  const { progress, epStatus } = await animeClient.setEpisodeStatus(
    selected.value.collection.id,
    payload
  )
  // 本地即时更新
  selected.value.progress = progress
  selected.value.collection.ep_status = epStatus
  // 即时上传：收藏级变更（ep_status 等）推到 Bangumi（单集标记已在 IPC 内直传）
  void window.acgn.sync.pushAll().catch(() => {})
}

function back() {
  // 暂存当前详情，供鼠标侧键「前进」重开
  if (selected.value) lastDetail.value = selected.value
  selected.value = null
  refreshList()
  // 恢复到进入详情前的列表滚动位置（nextTick 等列表 DOM 重建后再恢复高度才正确）
  nextTick(() => restoreContentScroll())
}

// 切换状态标签时刷新列表（仅列表视图可见时）
watch(activeStatus, () => {
  if (!selected.value) refreshList()
})

// 鼠标侧键前进/后退处理器（后退=关详情；前进=重开上次详情）
const navHandlers = {
  back: () => {
    if (selected.value) {
      back()
      return true
    }
    return false
  },
  forward: () => {
    if (!selected.value && lastDetail.value) {
      const d = lastDetail.value
      lastDetail.value = null
      void openDetail(d.subject.id)
      return true
    }
    return false
  }
}

onMounted(async () => {
  // 简介优先流式推送：主进程取到简介即推来，无需等待角色/关联加载，立即显示
  stopSummary = window.acgn.subjectExtra.onSummaryUpdated((p) => {
    const s = selected.value?.subject
    if (s && s.id === p.subjectId && !s.summary) s.summary = p.summary
  })
  // 标签/制作信息离线填充后联网补全：主进程推权威数据，就地置换（仍在看同一作品才覆盖）
  stopMeta = window.acgn.subjectExtra.onMetaUpdated((p) => {
    const s = selected.value?.subject
    if (s && s.id === p.subjectId) {
      s.tags = p.tags
      s.meta = p.meta
      s.metaTags = p.metaTags
      if (p.rating != null) s.rating = p.rating
    }
  })
  nav.register(navHandlers)
  await refreshList()
})

onUnmounted(() => {
  nav.unregister(navHandlers)
  stopSummary?.()
  stopMeta?.()
})
</script>

<template>
  <div>
    <header class="view-head">
      <h1>动画</h1>
      <button v-if="selected" class="back-btn" @click="back" aria-label="返回"><svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg></button>
    </header>

    <!-- 详情视图 -->
    <template v-if="selected">
      <DetailAnchors :items="anchors" />
      <div class="detail">
      <div v-if="settings.detailBanner && selected.subject.image_url" class="detail-banner" :style="{ backgroundImage: `url(${proxyImg(selected.subject.image_url)})` }"></div>
      <div class="detail__main" data-anchor="overview">
        <CoverImage
          :src="selected.subject.image_url"
          :alt="selected.subject.title"
          class="detail__poster"
        />
        <div class="detail__body">
          <h2>{{ selected.subject.title_cn || selected.subject.title }}</h2>
          <CollectionBar
            v-if="selected?.subject?.provider_subject_id"
            :provider-subject-id="selected.subject.provider_subject_id"
            :category="'anime'"
          />
          <EpisodeGrid
            :episodes="gridEpisodes"
            :total="selected.subject.total_episodes"
            :air-date="selected.subject.air_date"
            :subject-id="selected.subject.provider_subject_id"
            @mark="onMark"
          />
          <SynopsisBox v-if="selected.subject.summary" :text="selected.subject.summary" />
        </div>
      </div>
      <SubjectMetaPanel :subject="selected.subject" :collection="selected.collection" :loading="enriching" />
      <SubjectCharacters :subject-id="selected.subject?.id" :characters="selected.characters || []" data-anchor="characters" />
      <SubjectRelations :subject-id="selected.subject?.id" :relations="selected.relations || []" filter="single" data-anchor="single" @select="onSubjectSelect" />
      <SubjectRelations :subject-id="selected.subject?.id" :relations="selected.relations || []" filter="other" data-anchor="relations" @select="onSubjectSelect" />
      <SubjectTopics :subject-id="selected.subject?.provider_subject_id ?? null" />
      <TucaoBox :subject-id="selected.subject?.provider_subject_id ?? null" media-type="anime" data-anchor="tucao" />
      </div>
    </template>

    <!-- 列表视图 -->
    <div v-else>
      <StatusTabs v-model="activeStatus" category="anime" />
      <div class="grid">
        <div
          v-for="w in watching"
          :key="w.collectionId"
          class="card watching"
          role="button"
          tabindex="0"
          aria-label="打开「{{ w.titleCn || w.title }}」详情"
          @click="openDetail(w.subjectId)"
          @keydown.enter.prevent="openDetail(w.subjectId)"
          @keydown.space.prevent="openDetail(w.subjectId)"
          @contextmenu.prevent="onCardMenu($event, w)"
        >
          <CoverImage :src="w.imageUrl" :alt="w.title" class="card-cover" />
          <div class="title">{{ w.titleCn || w.title }}</div>
          <div v-if="activeStatus === 2 || activeStatus === 4 || activeStatus === 5" class="meta meta--rate">
            <span v-if="w.rating" class="my-rating">★ {{ w.rating }}</span>
            <span v-else-if="w.siteRating != null" class="site-rating">★ {{ w.siteRating }}</span>
            <span v-else class="site-rating">★ —</span>
            <span v-if="w.markedAt" class="mark-time">{{ formatMarkedAt(w.markedAt) }}</span>
          </div>
          <div v-else-if="activeStatus === 1" class="meta meta--rate">
            <span v-if="w.markedAt" class="mark-time">{{ formatMarkedAt(w.markedAt) }}</span>
          </div>
          <div v-else class="meta">已看 {{ w.epStatus }} / {{ w.totalEpisodes || 12 }}</div>
        </div>
        <EmptyState
          v-if="watching.length === 0"
          :text="`还没有${currentLabel}的动画`"
          hint="从 Bangumi 搜索并添加到收藏，即可在这里标记单集进度"
        >
          <button class="btn btn--primary btn--sm" @click="openSearch()">搜索添加</button>
        </EmptyState>
      </div>
    </div>
  </div>
</template>
