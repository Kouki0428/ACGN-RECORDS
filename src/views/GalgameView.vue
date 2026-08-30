<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import RouteEditor from '@/components/RouteEditor.vue'
import PurchaseInfo from '@/components/PurchaseInfo.vue'
import SubjectMetaPanel from '@/components/SubjectMetaPanel.vue'
import SubjectCharacters from '@/components/SubjectCharacters.vue'
import SubjectRelations from '@/components/SubjectRelations.vue'
import TucaoBox from '@/components/TucaoBox.vue'
import SubjectTopics from '@/components/SubjectTopics.vue'
import CollectionBar from '@/components/CollectionBar.vue'
import GameGallery from '@/components/GameGallery.vue'
import StatusTabs from '@/components/StatusTabs.vue'
import CoverImage from '@/components/CoverImage.vue'
import SynopsisBox from '@/components/SynopsisBox.vue'
import EmptyState from '@/components/EmptyState.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import DetailAnchors, { type AnchorItem } from '@/components/DetailAnchors.vue'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { usePagination } from '@/composables/usePagination'
import { useContextMenu } from '@/composables/useContextMenu'
import { buildCardMenu } from '@/composables/useCardContextMenu'
import { useSettingsStore } from '@/stores/settings'
import { proxyImg } from '@/utils/imgProxy'
import { useImagePreview } from '@/composables/useImagePreview'

const { openImage } = useImagePreview()
import { apiClient } from '@/services/apiClient'
import { collectionClient } from '@/services/collectionClient'
import { purchaseClient } from '@/services/purchaseClient'
import type { Subject, CollectionDetail, CollectionItem, GameGallery as GameGalleryData } from '@shared/types'
import { statusLabel } from '@/utils/statusLabels'
import { formatMarkedAt } from '@/utils/format'
import { useEntityCard } from '@/composables/useEntityCard'
import { scrollContentToTop, restoreContentScroll } from '@/utils/scroll'
import { useCollectionModal } from '@/composables/useCollectionModal'

// 关联作品 / 单行本点击：打开作品悬浮窗（而非跳网页）
const { open: openSubjectCard } = useEntityCard()
const { open: openSearch } = useSearchOverlay()
const { open: openMenu } = useContextMenu()
const settings = useSettingsStore()

// 详情页吸顶锚点（游戏多画廊/购买两个区块）
const anchors: AnchorItem[] = [
  { key: 'overview', label: '概览' },
  { key: 'gallery', label: '画廊' },
  { key: 'characters', label: '角色' },
  { key: 'single', label: '单行本' },
  { key: 'relations', label: '关联条目' },
  { key: 'purchase', label: '购买' },
  { key: 'topics', label: '讨论' },
    { key: 'tucao', label: '吐槽' }
]

// 卡片右键菜单：快速改状态 / 在 Bangumi 打开 / 删除收藏
function onCardMenu(e: MouseEvent, r: CollectionItem) {
  openMenu(
    e,
    buildCardMenu(
      {
        providerSubjectId: r.providerSubjectId,
        collectionId: r.collectionId,
        status: r.status ?? activeStatus.value,
        category: 'galgame',
        title: r.titleCn || r.title
      },
      { onChanged: refreshList }
    )
  )
}
function onSubjectSelect(id: number) {
  openSubjectCard('subject', id)
}
import { useNavHistory } from '@/composables/useNavHistory'

const CAT = 'galgame' as const

const playing = ref<CollectionItem[]>([])
const selected = ref<CollectionDetail | null>(null)
// 鼠标侧键「前进」重开目标：记录上次从详情退回列表时的作品（新导航会失效）
const lastDetail = ref<CollectionDetail | null>(null)

// 收藏悬浮窗保存（评分/状态/吐槽）后，刷新本详情页的收藏（含我的评价），使 SubjectMetaPanel 同步显示
const modal = useCollectionModal()
watch(
  () => modal.refreshTick.value,
  async () => {
    const id = selected.value?.subject?.id
    if (!id) return
    const fresh = await collectionClient.detailLocal(id)
    const cur = selected.value
    if (!cur || cur.subject?.id !== fresh.subject?.id) return
    selected.value = { ...cur, collection: fresh.collection }
  }
)
const nav = useNavHistory()
const enriching = ref(false)
let stopSummary: (() => void) | undefined
let stopMeta: (() => void) | undefined

// 当前选中的收藏状态（3=在玩 2=玩过 1=想玩 4=搁置 5=抛弃）
const activeStatus = ref<number>(3)
const currentLabel = computed(() => statusLabel(CAT, activeStatus.value))

// 分页：每页 100 张（总数 ≤100 不显示分页条）。切状态回第一页；翻页后列表滚回顶部。
const { page, totalPages, paged: pagedList, show: showPager, reset: resetPage } = usePagination(() => playing.value)
watch(activeStatus, resetPage)
watch(page, () => {
  document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 })
})
const purchase = ref<{ platform: string; price: number; currency: string }>({
  platform: '',
  price: 0,
  currency: 'CNY'
})
const saveMsg = ref('')

// 游戏画廊（VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组）
const gallery = ref<GameGalleryData | null>(null)
const galleryLoading = ref(false)
const galleryNote = ref('')

async function refreshList() {
  playing.value = await collectionClient.list(CAT, activeStatus.value)
}

async function add(subject: Subject) {
  const { subjectId } = await collectionClient.add(subject, 3)
  await openDetail(subjectId)
  await refreshList()
}

async function openDetail(subjectId: number) {
  // 新导航使「前进」历史失效
  lastDetail.value = null
  // 本地优先：立即展示已缓存的评分/标签/制作信息（不等待联网）
  const local = await collectionClient.detailLocal(subjectId)
  selected.value = local
  scrollContentToTop()
  const p = local.collection ? await purchaseClient.get(local.collection.id) : null
  purchase.value = {
    platform: p?.platform ?? '',
    price: p?.price ?? 0,
    currency: p?.currency ?? 'CNY'
  }
  saveMsg.value = ''
  // 载入已缓存的 CG 画廊（不联网）
  await loadGallery(false)
  // 后台联网补全：完成后再更新（仍在看同一作品才覆盖）
  enriching.value = true
  try {
    const full = await collectionClient.detail(subjectId)
    if (selected.value?.subject?.id === full.subject?.id) {
      // 防御：若在线结果偶发丢了评分，保留本地 Archive 已秒显的评分，避免被整体替换成 null
      if (
        full.subject &&
        selected.value.subject &&
        full.subject.rating == null &&
        selected.value.subject.rating != null
      ) {
        full.subject = { ...full.subject, rating: selected.value.subject.rating }
      }
      selected.value = full
    }
  } finally {
    enriching.value = false
  }
}

/** 加载游戏画廊：force=true 时重新联网抓取（从 Bangumi infobox 取 VNDB/DLsite/Steam 真实外链） */
async function loadGallery(force: boolean) {
  if (!selected.value?.subject?.provider_subject_id) return
  galleryLoading.value = true
  galleryNote.value = ''
  try {
    gallery.value = await apiClient.gallery(selected.value.subject.provider_subject_id, force)
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

async function onRoutesCount(count: number) {
  if (!selected.value?.collection) return
  const cid = selected.value.collection.id
  // 路线数为 Galgame 纯本地进度（BGM 游戏栏无进度概念），本地写入且不标 dirty，绝不推送
  const { epStatus } = await collectionClient.setProgress(cid, count, 'ep', true)
  if (selected.value.collection) selected.value.collection.ep_status = epStatus
  await refreshList()
}

/** 尚未加入收藏时，点击路线加号先建立收藏（状态=在玩），再交给 RouteEditor 继续添加 */
async function ensureCollectionForRoutes() {
  if (selected.value?.collection) return
  if (!selected.value) return
  const s = selected.value.subject
  const subject: Subject = {
    provider: 'bangumi',
    providerSubjectId: String(s.provider_subject_id ?? ''),
    category: 'galgame',
    title: s.title,
    titleCn: s.title_cn,
    summary: s.summary,
    imageUrl: s.image_url,
    totalEpisodes: s.total_episodes ?? undefined,
    totalVolumes: s.total_volumes ?? undefined,
    series: s.series,
    rating: s.rating,
    tags: s.tags,
    meta: s.meta
  }
  const { collectionId } = await collectionClient.add(subject, 3)
  selected.value = {
    ...selected.value,
    collection: { id: collectionId, status: 3, ep_status: 0, vol_status: 0 }
  }
  await refreshList()
}

async function savePurchase() {
  if (!selected.value?.collection) return
  // 购买平台：未选择或为「其它」占位哨兵时按未填处理
  const rawPlatform = purchase.value.platform
  const platform =
    rawPlatform && rawPlatform !== '__other__' ? rawPlatform : undefined
  const saved = await purchaseClient.save(selected.value.collection.id, {
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
      <h1>游戏</h1>
      <button v-if="selected" class="back-btn" @click="back" aria-label="返回"><svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg></button>
    </header>

    <!-- 详情视图 -->
    <template v-if="selected">
      <DetailAnchors :items="anchors" />
      <div class="detail" :class="{ glow: settings.immersiveGlow }">
      <div v-if="settings.detailBanner && selected.subject.image_url" class="detail-banner" :style="{ backgroundImage: `url(${proxyImg(selected.subject.image_url)})` }"></div>
      <div class="detail__main" data-anchor="overview">
          <CoverImage
            :src="selected.subject.image_url"
            :alt="selected.subject.title"
            class="detail__poster"
            @click="openImage(proxyImg(selected.subject.image_url), selected.subject.title)"
          />
        <div class="detail__body">
          <h2>{{ selected.subject.title_cn || selected.subject.title }}</h2>
          <CollectionBar
            v-if="selected?.subject?.provider_subject_id"
            :provider-subject-id="selected.subject.provider_subject_id"
            :category="'galgame'"
          />
          <p class="detail__sub">已通关 {{ selected.collection?.ep_status ?? 0 }} 条路线</p>
          <RouteEditor
            :collection-id="selected.collection?.id ?? null"
            @count="onRoutesCount"
            @request-add="ensureCollectionForRoutes"
          />
          <SynopsisBox v-if="selected.subject.summary" :text="selected.subject.summary" />
        </div>
      </div>

      <SubjectMetaPanel :subject="selected.subject" :collection="selected.collection" :loading="enriching" />

      <!-- 游戏画廊（复刻 Bangumi「游戏画廊」组件：VNDB 截图 / DLsite 样例 / Steam 截图） -->
      <GameGallery
        v-if="settings.showGallery"
        data-anchor="gallery"
        :gallery="gallery"
        :loading="galleryLoading"
        :note="galleryNote"
        @refresh="loadGallery(true)"
      />

      <SubjectCharacters v-if="settings.showCharacters" :subject-id="selected.subject?.id" :characters="selected.characters || []" data-anchor="characters" />
      <SubjectRelations :subject-id="selected.subject.id" :relations="selected.relations || []" v-if="settings.showVolumes" filter="single" data-anchor="single" @select="onSubjectSelect" />
      <SubjectRelations :subject-id="selected.subject.id" :relations="selected.relations || []" v-if="settings.showRelations" filter="other" data-anchor="relations" @select="onSubjectSelect" />

      <PurchaseInfo v-if="settings.showPurchase" v-model="purchase" data-anchor="purchase">
        <template #actions>
          <button class="btn btn--accent btn--sm" @click="savePurchase">保存购买信息</button>
        </template>
      </PurchaseInfo>
      <p v-if="saveMsg" class="ok">{{ saveMsg }}</p>

      <SubjectTopics v-if="settings.showTopics" :subject-id="selected.subject?.provider_subject_id ?? null" data-anchor="topics" />

      <TucaoBox v-if="settings.showTucao" :subject-id="selected.subject?.provider_subject_id ?? null" media-type="game" data-anchor="tucao" />
      </div>
    </template>

    <!-- 列表视图 -->
    <div v-else>
      <StatusTabs v-model="activeStatus" category="galgame" />
      <div class="grid">
        <div
          v-for="r in pagedList"
          :key="r.collectionId"
          class="card watching"
          role="button"
          tabindex="0"
          aria-label="打开「{{ r.titleCn || r.title }}」详情"
          @click="openDetail(r.subjectId)"
          @keydown.enter.prevent="openDetail(r.subjectId)"
          @keydown.space.prevent="openDetail(r.subjectId)"
          @contextmenu.prevent="onCardMenu($event, r)"
        >
          <CoverImage :src="r.imageUrl" :alt="r.title" class="card-cover" />
          <div class="title">{{ r.titleCn || r.title }}</div>
          <div v-if="activeStatus === 2 || activeStatus === 4 || activeStatus === 5" class="meta meta--rate">
            <span v-if="r.rating" class="my-rating">★ {{ r.rating }}</span>
            <span v-else-if="r.siteRating != null" class="site-rating">★ {{ r.siteRating }}</span>
            <span v-else class="site-rating">★ —</span>
            <span v-if="r.markedAt" class="mark-time">{{ formatMarkedAt(r.markedAt) }}</span>
          </div>
          <div v-else-if="activeStatus === 1" class="meta meta--rate">
            <span v-if="r.markedAt" class="mark-time">{{ formatMarkedAt(r.markedAt) }}</span>
          </div>
          <div v-else class="meta">已通关 {{ r.epStatus }} 条路线</div>
        </div>
        <EmptyState
          v-if="playing.length === 0"
          :text="`还没有${currentLabel}的游戏`"
          hint="从 Bangumi 搜索并添加到收藏，即可在这里追踪通关进度"
        >
          <button class="btn btn--primary btn--sm" @click="openSearch()">搜索添加</button>
        </EmptyState>
      </div>
      <PaginationBar v-if="showPager" v-model:page="page" :total-pages="totalPages" />
    </div>
  </div>
</template>

<style scoped>
/* 画廊样式已抽到 GameGallery.vue 组件内 */
</style>
