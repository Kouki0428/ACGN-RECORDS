<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import ProgressEditor from '@/components/ProgressEditor.vue'
import SubjectMetaPanel from '@/components/SubjectMetaPanel.vue'
import SubjectCharacters from '@/components/SubjectCharacters.vue'
import SubjectRelations from '@/components/SubjectRelations.vue'
import TucaoBox from '@/components/TucaoBox.vue'
import SubjectTopics from '@/components/SubjectTopics.vue'
import CollectionBar from '@/components/CollectionBar.vue'
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
import { collectionClient } from '@/services/collectionClient'
import type { Subject, CollectionDetail, CollectionItem } from '@shared/types'
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

// 详情页吸顶锚点
const anchors: AnchorItem[] = [
  { key: 'overview', label: '概览' },
  { key: 'characters', label: '角色' },
  { key: 'single', label: '单行本' },
  { key: 'relations', label: '关联条目' },
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
        category: 'light_novel',
        title: r.titleCn || r.title
      },
      { onChanged: refreshReading }
    )
  )
}
function onSubjectSelect(id: number) {
  openSubjectCard('subject', id)
}

const CAT = 'light_novel' as const

const reading = ref<CollectionItem[]>([])
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
const editValue = ref(0)
const editVolValue = ref(0)
const enriching = ref(false)
let stopSummary: (() => void) | undefined
let stopMeta: (() => void) | undefined

// 当前选中的收藏状态（3=在读 2=读过 1=想读 4=搁置 5=抛弃）
const activeStatus = ref<number>(3)
const currentLabel = computed(() => statusLabel(CAT, activeStatus.value))

async function refreshReading() {
  reading.value = await collectionClient.list(CAT, activeStatus.value)
}

async function addToReading(subject: Subject) {
  const { subjectId } = await collectionClient.add(subject, 3)
  await openDetail(subjectId)
  await refreshReading()
}

async function openDetail(subjectId: number) {
  // 新导航使「前进」历史失效
  lastDetail.value = null
  // 本地优先：立即展示已缓存的评分/标签/制作信息（不等待联网）
  const local = await collectionClient.detailLocal(subjectId)
  selected.value = local
  scrollContentToTop()
  editValue.value = local.collection?.ep_status ?? 0
  editVolValue.value = local.collection?.vol_status ?? 0
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

// 书籍进度变更后立即上传到 Bangumi（只推 dirty 收藏），不必等 5 分钟定时同步
function pushNow() {
  void window.acgn.sync.pushAll().catch(() => {})
}

async function onProgressEp(value: number) {
  if (!selected.value?.collection) return
  editValue.value = value
  const { epStatus } = await collectionClient.setProgress(selected.value.collection.id, value, 'ep')
  if (selected.value.collection) selected.value.collection.ep_status = epStatus
  pushNow()
  await refreshReading()
}

async function onProgressVol(value: number) {
  if (!selected.value?.collection) return
  editVolValue.value = value
  const { volStatus } = await collectionClient.setProgress(selected.value.collection.id, value, 'vol')
  if (selected.value.collection) selected.value.collection.vol_status = volStatus
  pushNow()
  await refreshReading()
}

function back() {
  // 暂存当前详情，供鼠标侧键「前进」重开
  if (selected.value) lastDetail.value = selected.value
  selected.value = null
  refreshReading()
  // 恢复到进入详情前的列表滚动位置（nextTick 等列表 DOM 重建后再恢复高度才正确）
  nextTick(() => restoreContentScroll())
}

// 切换状态标签时刷新列表（仅列表视图可见时）
watch(activeStatus, () => {
  if (!selected.value) refreshReading()
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
  await refreshReading()
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
      <h1>小说</h1>
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
            :category="'light_novel'"
          />
          <ProgressEditor
            label="已读章"
            :value="editValue"
            :total="selected.subject.total_episodes ?? null"
            @update="onProgressEp"
          />
          <ProgressEditor
            v-if="selected.subject.series != false"
            label="已读卷"
            :value="editVolValue"
            :total="selected.subject.total_volumes ?? null"
            @update="onProgressVol"
          />
          <SynopsisBox v-if="selected.subject.summary" :text="selected.subject.summary" />
        </div>
      </div>
      <SubjectMetaPanel :subject="selected.subject" :collection="selected.collection" :loading="enriching" />
      <SubjectCharacters :subject-id="selected.subject?.id" :characters="selected.characters || []" data-anchor="characters" />
      <SubjectRelations :subject-id="selected.subject.id" :relations="selected.relations || []" filter="single" data-anchor="single" @select="onSubjectSelect" />
      <SubjectRelations :subject-id="selected.subject.id" :relations="selected.relations || []" filter="other" data-anchor="relations" @select="onSubjectSelect" />
      <SubjectTopics :subject-id="selected.subject?.provider_subject_id ?? null" data-anchor="topics" />
      <TucaoBox :subject-id="selected.subject?.provider_subject_id ?? null" media-type="book" data-anchor="tucao" />
      </div>
    </template>

    <!-- 列表视图 -->
    <div v-else>
      <StatusTabs v-model="activeStatus" category="light_novel" />
      <div class="grid">
        <div
          v-for="r in reading"
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
          <div v-else class="meta">
            章 {{ r.epStatus }}/{{ r.totalEpisodes && r.totalEpisodes > 0 ? r.totalEpisodes : '??' }}<template v-if="r.series != false"> - 卷 {{ r.volStatus }}/{{ r.totalVolumes && r.totalVolumes > 0 ? r.totalVolumes : '??' }}</template>
          </div>
        </div>
        <EmptyState
          v-if="reading.length === 0"
          :text="`还没有${currentLabel}的小说`"
          hint="从 Bangumi 搜索并添加到收藏，即可在这里追踪阅读进度"
        >
          <button class="btn btn--primary btn--sm" @click="openSearch()">搜索添加</button>
        </EmptyState>
      </div>
    </div>
  </div>
</template>
