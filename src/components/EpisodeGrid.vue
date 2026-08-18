<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { EpisodeMarkPayload } from '@shared/types'
import { useEpisodeCommentModal } from '@/composables/useEpisodeCommentModal'
import { useEntityCard } from '@/composables/useEntityCard'
import { openGridId, nextGridUid } from '@/composables/episodeHoverState'

export interface EpisodeCell {
  id: number
  epNumber: number
  /** 已看状态 */
  watched?: boolean
  /** 想看状态（与 watched 互斥） */
  want?: boolean
  /** 抛弃状态（与 watched/want 互斥） */
  dropped?: boolean
  title?: string | null
  airDate?: string | null
  duration?: string | null
  /** 剧集类型：0=正篇 1=特别篇(SP) 2=OP 3=ED …（用于 SP 分隔格） */
  epType?: number
  /** 分隔格（如特别篇前的「|SP」占位），仅占一个格子位置，不可点击/标记 */
  isSep?: boolean
}

const props = defineProps<{
  /** 真实剧集（含 watched/want 状态）；为空则用 total 或默认 12 生成占位格子 */
  episodes?: EpisodeCell[]
  /** 总话数；episodes 为空时决定格子数量 */
  total?: number | null
  /** 作品级首播日期（剧集无单集 airDate 时的兜底） */
  airDate?: string | null
  /** 媒体类型（预留，决定状态词；当前固定显示 看过/看到/想看/撤销） */
  category?: string
  /** 只读（浏览态）：点击格子/按钮不触发标记 */
  readonly?: boolean
  /** Bangumi 作品 id（字符串）；点击真实单集格子时打开单集评论悬浮窗用 */
  subjectId?: string
}>()
const emit = defineEmits<{ (e: 'mark', payload: EpisodeMarkPayload): void }>()

// 格子数量：优先用真实剧集数；否则 total；都没有视为 12 话
const count = computed<number>(() => {
  if (props.episodes && props.episodes.length > 0) return props.episodes.length
  const t = props.total
  return typeof t === 'number' && t > 0 ? t : 12
})

// 是否为「特别篇(SP)」：Bangumi 中 SP 的全局集号 sort 必为小数（如 4.5 / 13.5），
// 正片永远是整数。用「集号是否为正整数」判定，完全不依赖缓存表 ep_type 列，
// 即使旧 bundle 把 ep_type 错写成 0 也能正确识别并置后（渲染层兜底，无需重启 vite）。
function isSp(ep: EpisodeCell): boolean {
  if (ep.epType === 1) return true
  const n = Number(ep.epNumber)
  return Number.isFinite(n) && n > 0 && !Number.isInteger(n)
}

// 真实剧集直接映射；无数据则生成占位格子（id 取负，mark 时忽略）。
// 最终排序保证：正片(非 SP)按 epNumber 升序在前，特别篇(SP)按 epNumber 升序统一排到最后。
// 仅在「第一个 SP」之前插入一个占用格子位置的「|SP」分隔格，仅视觉分隔、不可交互。
const cells = computed<EpisodeCell[]>(() => {
  if (props.episodes && props.episodes.length > 0) {
    const list = [...props.episodes].sort((a, b) => {
      const aSp = isSp(a) ? 1 : 0
      const bSp = isSp(b) ? 1 : 0
      if (aSp !== bSp) return aSp - bSp
      return Number(a.epNumber) - Number(b.epNumber)
    })
    const out: EpisodeCell[] = []
    let sepInserted = false
    for (const e of list) {
      if (isSp(e) && !sepInserted) {
        out.push({ id: -1, epNumber: 0, isSep: true, watched: false, want: false, dropped: false })
        sepInserted = true
      }
      out.push({
        ...e,
        watched: !!e.watched,
        want: !!e.want,
        dropped: !!e.dropped
      })
    }
    return out
  }
  const n = count.value
  return Array.from({ length: n }, (_, i) => ({
    id: -(i + 1),
    epNumber: i + 1,
    watched: false,
    want: false
  }))
})

// 今天 / 明天（本地日期，ISO YYYY-MM-DD）；用于「今天或明天播出」判定
function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const today = todayISO()
function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const tomorrow = tomorrowISO()

// 分色（优先级从高到低）：看过 / 想看 / 抛弃 / 今天或明天播出 / 已播未看 / 未播出
function cellClass(ep: EpisodeCell): string {
  if (ep.watched) return 'ep-watched'
  if (ep.want) return 'ep-want'
  if (ep.dropped) return 'ep-dropped'
  if (ep.airDate) {
    // 今天或明天播出 → 浅绿；早于今天 → 已播未看（浅蓝）；晚于明天 → 未播出（灰）
    if (ep.airDate === today || ep.airDate === tomorrow) return 'ep-airing'
    if (ep.airDate < today) return 'ep-aired'
    return 'ep-future'
  }
  return ''
}

// —— 悬浮小卡片 ——
// 用 <Teleport to="body"> 渲染到 body，脱离 .hcard 的 overflow:hidden 与任何卡片/overlay
// 的层叠上下文；定位用 position:fixed + 实时 getBoundingClientRect（视口坐标），
// 因此页面（主内容区 / 作品悬浮窗内部）无论由哪个滚动容器滚动，都能通过
// 捕获阶段的 scroll 监听 + 重算让它牢牢贴在对应格子旁、跟随滑动。
// 单例：activeIndex 为当前展示的格子下标；鼠标离开格子【不关闭】；
// 关闭条件：①悬停到另一个格子（切换）②点右上角叉 ③点击卡片外区域
// ④点格子打开单集评论 ⑤（新增）鼠标曾进入过卡片本体、再滑出整个卡片即关闭。
// 其中 ⑤ 实现「滑到过悬浮窗上面再滑出它就关闭」；若只是停在格子上没移到卡片上则不关。
const CARD_W = 252
// 跨所有 EpisodeGrid 实例共享的「当前哪个实例在显示悬停卡片」单例：
// 主页有多个作品的格子实例，必须保证同时只有一个悬停卡片，否则会多部作品的标记卡同时出现。
const activeIndex = ref<number | null>(null)
const hoverCell = ref<HTMLElement | null>(null) // 当前悬停的格子 DOM（用于实时取位置）
const hasEnteredCard = ref(false) // 鼠标是否曾进入过悬停卡片本体（滑到过上面）
const blockEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
const tick = ref(0) // 滚动/缩放时自增，强制 cardStyle 用最新格子位置重算
const scrollBox = ref<HTMLElement | null>(null) // 格子所在滚动容器（主页=主内容区 / 作品悬浮窗=面板内部滚动区）

// 向上找最近的「可滚动祖先」，作为卡片可见区域的判定边界（裁剪框的矩形）：
// 主页=主内容区；作品悬浮窗=面板内部滚动区。卡片用一层固定在该矩形、overflow:hidden 的
// 裁剪框包裹，始终跟随格子；滑出该矩形即被边界「裁断」（露出一部分、其余被切掉），
// 而非消失或钉在边框上。取不到则退回整个视口。
function findScrollBox(el: HTMLElement | null): HTMLElement | null {
  let n: HTMLElement | null = el?.parentElement ?? null
  while (n && n !== document.documentElement && n !== document.body) {
    const s = getComputedStyle(n)
    const scrollable =
      s.overflowY === 'auto' ||
      s.overflowY === 'scroll' ||
      s.overflow === 'auto' ||
      s.overflow === 'scroll'
    if (scrollable && n.scrollHeight > n.clientHeight + 1) return n
    n = n.parentElement
  }
  return null
}

const activeCell = computed(() =>
  activeIndex.value != null ? cells.value[activeIndex.value] ?? null : null
)

// 可见区域矩形（裁剪框边界）：随滚动/缩放重算。
const clipRect = computed(() => {
  void tick.value
  const box = scrollBox.value
  if (!box) {
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    return { left: 0, top: 0, width: vw, height: vh }
  }
  const r = box.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
})

// 裁剪框：固定贴在可见区域矩形上，overflow:hidden 实现「边界裁断」；pointer-events:none 不挡下方格子。
const clipStyle = computed(() => {
  const c = clipRect.value
  return {
    position: 'fixed',
    left: `${c.left}px`,
    top: `${c.top}px`,
    width: `${c.width}px`,
    height: `${c.height}px`,
    overflow: 'hidden',
    zIndex: 100000,
    pointerEvents: 'none'
  } as Record<string, string | number>
})

const cardStyle = computed(() => {
  void tick.value // 依赖：滚动/缩放时触发重算，让卡片跟随格子
  const cell = hoverCell.value
  if (!cell) return {}
  const r = cell.getBoundingClientRect()
  const c = clipRect.value
  const cardH = cardEl.value?.offsetHeight ?? 200
  let top = r.bottom + 8 // 默认放格子下方
  // 若下方放不下（会探出裁剪框底部），且上方能完整容纳，则翻到上方，保持可用（不强制隐藏）。
  if (top + cardH > c.top + c.height && r.top - cardH - 8 >= c.top) {
    top = r.top - cardH - 8
  }
  // 卡片相对裁剪框左上角的绝对定位；不夹左右/上下——超出裁剪框的部分由 overflow:hidden 裁断。
  const left = r.left + r.width / 2 - CARD_W / 2
  return {
    position: 'absolute',
    left: `${left - c.left}px`,
    top: `${top - c.top}px`,
    width: `${CARD_W}px`,
    pointerEvents: 'auto'
  } as Record<string, string | number>
})

function onCellEnter(i: number, ev: MouseEvent) {
  openGridId.value = myGridId
  activeIndex.value = i
  const cell = ev.currentTarget as HTMLElement
  hoverCell.value = cell
  scrollBox.value = findScrollBox(cell)
  hasEnteredCard.value = false // 切换到新格子，重置「是否进过卡片」状态
}
function closeCard() {
  if (openGridId.value === myGridId) openGridId.value = -1
  activeIndex.value = null
  hoverCell.value = null
  scrollBox.value = null
  hasEnteredCard.value = false
}
// 鼠标进入悬停卡片本体：标记「滑到过上面」。
// 配合 onCardLeave：一旦进入过卡片、再滑出整个卡片（无论移到格子还是别处）即关闭，
// 实现「鼠标滑到过上面再滑出悬浮窗就关闭」；没进过卡片（仅停在格子）仍保持不关。
function onCardEnter() {
  hasEnteredCard.value = true
}
function onCardLeave() {
  if (hasEnteredCard.value) closeCard()
}
// 点击单集格子 → 打开「单集评论」（仅真实 Bangumi 单集 id > 0 且有 subjectId 时）。
// 标记（看过/看到/想看/抛弃/撤销）仍由悬停卡片里的按钮触发，不丢功能。
// 进入单集评论：先 setData 写入要展示的哪一集数据，再 entity.push('episode', ep.id) ——
// 单集评论作为 useEntityCard 导航栈的第 4 种 body 并入 EntitySubjectCard 同一 overlay，
// 因此悬浮窗容器不卸载、仅把头部「作品名」替换为「单集标题」、下方内容进行加载
// （与作品→角色/CV 在同一 overlay 内只换内部内容、零重载闪烁的体验完全一致）。
const episodeModal = useEpisodeCommentModal()
const entity = useEntityCard()
const myGridId = nextGridUid()
function onCellClick(ep: EpisodeCell) {
  if (props.readonly) return
  if (ep.id > 0 && props.subjectId) {
    closeCard() // 打开单集评论悬浮窗前先收起小标记卡，避免两者叠在一起
    episodeModal.setData(props.subjectId, ep.id, {
      epNumber: ep.epNumber,
      title: ep.title,
      airDate: ep.airDate,
      duration: ep.duration
    })
    entity.push('episode', ep.id)
  }
}

// 单集标记：看过（切换）/ 想看（切换）/ 抛弃（切换）/ 撤销（清除所有标记）
function markSingle(action: 'watched' | 'want' | 'drop' | 'undo') {
  const cell = activeCell.value
  if (!cell || props.readonly || cell.id <= 0) return
  emit('mark', { action, episodeId: cell.id })
}
// 「看到」：把当前集及之前所有集标记为已看
function markUpTo() {
  const cell = activeCell.value
  const idx = activeIndex.value
  if (!cell || idx == null || props.readonly || cell.id <= 0) return
  const upToIds = cells.value.slice(0, idx + 1).filter((c) => !c.isSep && c.id > 0).map((c) => c.id)
  emit('mark', { action: 'watched', episodeId: cell.id, upToIds })
}

// 按钮高亮态：当前集已处于该状态则高亮
const watchedOn = computed(() => !!activeCell.value?.watched)
const wantOn = computed(() => !!activeCell.value?.want)
const droppedOn = computed(() => !!activeCell.value?.dropped)
// 撤销：当前集有任何标记（已看/想看/抛弃）时才出现并高亮，表示可清除
const undoOn = computed(
  () =>
    !!activeCell.value &&
    (activeCell.value.watched || activeCell.value.want || activeCell.value.dropped)
)

// 点击卡片外区域 → 关闭（仅当前激活实例响应，避免多实例互相误关）
function onDocPointerDown(e: PointerEvent) {
  if (openGridId.value !== myGridId) return
  if (activeIndex.value == null) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (cardEl.value && cardEl.value.contains(t)) return
  if (t.closest('.ep-cell')) return
  closeCard()
}
// 滚动/缩放时让悬浮卡重新贴住格子（rAF 节流）。用捕获阶段监听，
// 可捕捉主内容区 / 作品悬浮窗内部等任意滚动容器的 scroll，无需知道具体哪个容器在滚。
let rafId = 0
function scheduleRepos() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    tick.value++
  })
}
function onScrollCapture() {
  if (hoverCell.value) scheduleRepos()
}
function onResize() {
  if (hoverCell.value) scheduleRepos()
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('scroll', onScrollCapture, true)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('scroll', onScrollCapture, true)
  window.removeEventListener('resize', onResize)
  if (rafId) cancelAnimationFrame(rafId)
  if (openGridId.value === myGridId) openGridId.value = -1
})
</script>

<template>
  <div ref="blockEl" class="episode-block">
    <div class="episode-grid">
      <template v-for="(ep, i) in cells" :key="ep.id">
        <div v-if="ep.isSep" class="ep-cell ep-sep">
          <svg class="ep-sep-svg" preserveAspectRatio="none" aria-hidden="true">
            <line x1="1.5" y1="0" x2="1.5" y2="100%" stroke="#7fd1a3" stroke-width="2" />
            <text x="18" y="50%" text-anchor="middle" dominant-baseline="central" fill="#7fd1a3" font-size="14" font-weight="700">SP</text>
          </svg>
        </div>
        <button
          v-else
          class="ep-cell"
          :class="[cellClass(ep), { active: activeIndex === i }]"
          :title="`ep.${ep.epNumber}`"
          @mouseenter="onCellEnter(i, $event)"
          @click="onCellClick(ep)"
        >
          {{ ep.epNumber }}
        </button>
      </template>
    </div>

    <Teleport to="body">
      <div v-if="activeCell && openGridId === myGridId" class="ep-clip" :style="clipStyle">
        <div ref="cardEl" class="ep-hover-card" :style="cardStyle" @mouseenter="onCardEnter" @mouseleave="onCardLeave">
        <button class="ep-close" type="button" title="关闭" aria-label="关闭" @click.stop="closeCard">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
        <div class="ep-hover-head">
          <span class="ep-no">ep.{{ activeCell.epNumber }}</span>
          <span v-if="activeCell.epType === 1" class="ep-sp-tag">特别篇</span>
        </div>
        <div class="ep-title">{{ activeCell.title || ('第 ' + activeCell.epNumber + ' 话') }}</div>
        <div class="ep-status-row">
          <button class="ep-status-tag" :class="{ on: watchedOn }" type="button" @click.stop="markSingle('watched')">看过</button>
          <button class="ep-status-tag" type="button" @click.stop="markUpTo">看到</button>
          <button class="ep-status-tag" :class="{ on: wantOn }" type="button" @click.stop="markSingle('want')">想看</button>
          <button class="ep-status-tag" :class="{ on: droppedOn }" type="button" @click.stop="markSingle('drop')">抛弃</button>
          <button
            v-if="undoOn"
            class="ep-status-tag ep-undo-tag"
            :class="{ on: undoOn }"
            type="button"
            @click.stop="markSingle('undo')"
          >撤销</button>
        </div>
        <div class="ep-meta">
          <span>首播: {{ activeCell.airDate || airDate || '—' }}</span>
          <span>时长: {{ activeCell.duration || '—' }}</span>
        </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.episode-block {
  position: relative;
  margin: 8px 0 4px;
}
.episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 36px);
  gap: 6px;
}
.ep-cell {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: transform 0.1s ease, border-color 0.15s ease, background 0.15s ease,
    color 0.15s ease;
}
/* 特别篇(SP)分隔格：占一个格子位置，竖向分隔线贴左缘贯穿整格，浅绿色，不可交互 */
.ep-cell.ep-sep {
  cursor: default;
  pointer-events: none;
  background: transparent;
  border: none;
  padding: 0;
  position: relative;
  gap: 0;
}
.ep-sep-svg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
/* 看过：蓝色 */
.ep-cell.ep-watched {
  background: #2f80ed;
  color: #fff;
  border-color: #2f80ed;
}
/* 想看：粉色 */
.ep-cell.ep-want {
  background: #ec6f9e;
  color: #3a0014;
  border-color: #ec6f9e;
}
/* 抛弃：暗灰 + 删除线，明显区别于未播出的浅灰 */
.ep-cell.ep-dropped {
  background: #4b5563;
  color: #e5e7eb;
  border-color: #4b5563;
  text-decoration: line-through;
}
/* 今天或明天播出：浅绿 */
.ep-cell.ep-airing {
  background: #86c9a3;
  color: #0c3a24;
  border-color: #86c9a3;
}
/* 已播未看：浅蓝（明显比「看过」更浅 + 描边，避免与蓝色混淆） */
.ep-cell.ep-aired {
  background: #dcebfb;
  color: #16395c;
  border-color: #b6d4f1;
}
/* 未播出：沿用默认浅灰（与普通未标记格子一致） */
.ep-cell.ep-future {
  background: var(--bg-elev);
  color: var(--text-dim);
  border-color: var(--border);
}
.ep-cell:not(.ep-watched):not(.ep-want):not(.ep-airing):not(.ep-aired):hover {
  border-color: var(--accent-2);
  color: var(--text);
}
.ep-cell.active {
  border-color: var(--accent-2);
  transform: translateY(-2px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.ep-hover-card {
  position: absolute;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: ep-pop 0.12s ease;
  pointer-events: auto;
}
@keyframes ep-pop {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ep-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease, color 0.15s ease;
}
.ep-close:hover {
  background: var(--bg-elev);
  color: var(--text);
}
.ep-hover-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding-right: 22px;
}
.ep-no {
  font-weight: 700;
  color: var(--text);
  flex-shrink: 0;
}
.ep-sp-tag {
  font-size: 10px;
  font-weight: 700;
  color: #d98b3a;
  border: 1px solid #d98b3a;
  border-radius: 999px;
  padding: 0 6px;
  line-height: 16px;
}
.ep-title {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ep-status-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ep-status-tag {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.ep-status-tag:hover {
  border-color: var(--accent-2);
  color: var(--text);
}
.ep-status-tag.on {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
/* 撤销按钮：琥珀色，与四个标记按钮区分（用于清除标记） */
.ep-status-tag.ep-undo-tag {
  border-color: #d98b3a;
  color: #d98b3a;
}
.ep-status-tag.ep-undo-tag.on {
  background: #d98b3a;
  color: #fff;
  border-color: #d98b3a;
}
.ep-meta {
  display: flex;
  gap: 16px;
  color: var(--text-dim);
  flex-wrap: wrap;
}
</style>
