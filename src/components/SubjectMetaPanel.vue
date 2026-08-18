<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Category, SubjectTag, SubjectMeta, SubjectPerson } from '@shared/types'
import { collectionClient } from '@/services/collectionClient'
import { subjectClient } from '@/services/subjectClient'
import { useEntityCard } from '@/composables/useEntityCard'

const props = defineProps<{
  subject?: {
    category?: Category
    tags?: SubjectTag[]
    meta?: SubjectMeta[]
    /** 官方/系统标签（Bangumi meta_tags 顶层字符串数组，如 ["机战","TV","日本","原创","战斗"]），与用户自由标注的 tags 区分 */
    metaTags?: string[]
    rating?: number
    /** Bangumi 评分分布（1–10 星票数）与总票数，离线 Archive（score_details）优先，联网详情时刷新 */
    ratingCount?: number[]
    ratingTotal?: number
    /** 兼容：原始 DB 行为蛇形字段（运行时 subject 来自 subjects 行） */
    provider?: string
    providerSubjectId?: string
    provider_subject_id?: string
    /** Bangumi 站点排名（如 "#885"），来自 Archive 离线库 / 联网详情 */
    rank?: string
  } | null
  /** 本地收藏（含 status / rating），用于「我的评价」同步 Bangumi */
  collection?: { id?: number; status?: number; rating?: number | null } | null
  /** 是否仍在后台联网补全（评分可能尚未取到） */
  loading?: boolean
  /**
   * 是否用「压栈」方式打开人物卡（悬浮窗内点制作信息人名时为 true，使侧键/返回可在卡片内穿梭；
   * 详情页内点则为 false，直接替换打开）。与 SubjectCharacters 的 pushNav 同义。
   */
  pushNav?: boolean
}>()

const entity = useEntityCard()

function tags(): SubjectTag[] {
  const t = props.subject?.tags
  return Array.isArray(t) ? t : []
}
function metaTags(): string[] {
  const m = props.subject?.metaTags
  return Array.isArray(m) ? m : []
}
// 归一化名（去空格/忽略大小写），用于官方标签与用户标签之间、以及各自内部的判重
function normalizedName(s: string): string {
  return String(s ?? '').trim().toLowerCase()
}
// 官方/系统标签（meta_tags），自身按归一化名去重
function officialTags(): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of metaTags()) {
    const key = normalizedName(m)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(m)
  }
  return result
}
// 用户自由标注标签：排除已作为官方展示的（按归一化名判重避免同一标签出现两次），自身也去重
function userTags(): SubjectTag[] {
  const offSet = new Set(officialTags().map(normalizedName))
  const seen = new Set<string>()
  const result: SubjectTag[] = []
  for (const t of tags()) {
    const key = normalizedName(t.name)
    if (!key || offSet.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(t)
  }
  return result
}
// 官方标签（meta_tags 自带无 count）若与某用户标注同名，回查其标注次数用于显示「·N」
function officialCount(name: string): number | undefined {
  const key = normalizedName(name)
  const t = tags().find((x) => normalizedName(x.name) === key)
  return t && t.count ? t.count : undefined
}
function meta(): SubjectMeta[] {
  const m = props.subject?.meta
  return Array.isArray(m) ? m : []
}
function rating(): number | null {
  const r = props.subject?.rating
  return typeof r === 'number' && isFinite(r) ? r : null
}

// 星级 → 定性标签（按 Bangumi 站点评分四舍五入后取对应标签，显示在评分右侧）
const RATING_LABELS: Record<number, string> = {
  1: '不忍直视',
  2: '很差',
  3: '差',
  4: '较差',
  5: '不过不失',
  6: '还行',
  7: '推荐',
  8: '力荐',
  9: '神作',
  10: '超神作'
}
const bgmRatingLabel = computed<string | null>(() => {
  const r = rating()
  if (r == null) return null
  const idx = Math.min(10, Math.max(1, Math.round(r)))
  return RATING_LABELS[idx] ?? null
})
// 悬浮「我的评价」星星时，按当前悬浮星数显示对应标签（红字，移开消失）
const hoverLabel = computed<string | null>(() => {
  if (hoverRating.value == null) return null
  return RATING_LABELS[hoverRating.value] ?? null
})

// 评分分布（右侧柱状图）：Bangumi 的 1–10 星票数
const ratingCount = computed<number[] | null>(() => {
  const c = props.subject?.ratingCount
  return Array.isArray(c) && c.length === 10 ? c : null
})
// 反转渲染顺序：10 星在左、1 星在右
const ratingDist = computed<{ star: number; count: number }[] | null>(() => {
  const c = ratingCount.value
  if (!c) return null
  const arr: { star: number; count: number }[] = []
  for (let star = 10; star >= 1; star--) arr.push({ star, count: c[star - 1] ?? 0 })
  return arr
})
const ratingTotal = computed<number>(() => {
  const t = props.subject?.ratingTotal
  return typeof t === 'number' && t > 0 ? t : 0
})
const maxCount = computed<number>(() => {
  const d = ratingDist.value
  return d && d.length ? Math.max(1, ...d.map((x) => x.count)) : 1
})
function barHeight(c: number): string {
  return `${Math.round((c / maxCount.value) * 100)}%`
}
// 该星票数占总票数的百分比（保留两位小数）
function distPct(c: number): string {
  const t = ratingTotal.value
  if (!t) return '0.00'
  return ((c / t) * 100).toFixed(2)
}
// Bangumi 站点排名文案：动画→Anime，漫画/小说→Book，游戏→Game
const rankTypeWord = computed<string>(() => {
  const c = props.subject?.category
  if (c === 'manga' || c === 'light_novel') return 'Book'
  if (c === 'galgame') return 'Game'
  return 'Anime'
})
const rankNum = computed<string | null>(() => {
  const r = props.subject?.rank
  if (!r) return null
  return String(r).replace(/^#/, '')
})

// 「我的评价」：本地评分值，并同步到 Bangumi
const myRating = ref<number | null>(null)
const hoverRating = ref<number | null>(null)
const displayRating = computed<number | null>(() => hoverRating.value ?? myRating.value)
// 同步状态：idle / saving / synced / local（仅本地）/ error
const syncState = ref<'idle' | 'saving' | 'synced' | 'local' | 'error'>('idle')
const syncError = ref<string | null>(null)

// 解析作品来源（运行时 subject 来自 subjects 行，字段可能是蛇形）
const provider = computed(
  () => props.subject?.provider ?? (props.subject as Record<string, unknown> | undefined)?.provider
)
const providerSubjectId = computed(() => {
  const s = props.subject as Record<string, unknown> | undefined
  return (props.subject?.providerSubjectId ?? s?.provider_subject_id) as string | undefined
})
const isBangumi = computed(() => provider.value === 'bangumi' && !!providerSubjectId.value)

// 打开/切换作品时，用收藏里的评分初始化星星（跟踪 rating 本身：
// 本地行 id 不变、或远端评分合并进来合成对象 id 为 undefined 时也能正确点亮）
watch(
  () => props.collection?.rating ?? null,
  (r) => {
    myRating.value = r
  },
  { immediate: true }
)

async function setMyRating(n: number) {
  myRating.value = n
  if (!isBangumi.value || !providerSubjectId.value) return
  syncState.value = 'saving'
  syncError.value = null
  try {
    const res = await collectionClient.setRating(providerSubjectId.value, n)
    if (res.synced) syncState.value = 'synced'
    else {
      syncState.value = 'local'
      syncError.value = res.error ?? '已保存到本地'
    }
  } catch (e) {
    syncState.value = 'error'
    syncError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---------- 制作信息卡片：默认折叠，仅显示制作公司/导演，点击展开 ----------
const metaExpanded = ref(false)

// 折叠时优先展示的「核心制作信息」键，按作品类型区分：
// - 动画：制作公司/动画制作/导演/放送开始（沿用旧默认）
// - 轻小说/漫画：作者 + 发售日（出版日期）；其余需展开
// - 游戏：剧本/开发/游戏类型/发行日期（发售日）；其余需展开
const PRIORITY_BY_CATEGORY: Record<string, string[]> = {
  light_novel: ['作者', '发售日', '発売日', '出版日期', '出版日'],
  manga: ['作者', '发售日', '発売日', '出版日期', '出版日'],
  galgame: ['剧本', '开发', '游戏类型', '发行日期', '发售日', '発売日']
}
const DEFAULT_PRIORITY = [
  '制作公司',
  '动画制作',
  '导演',
  '出版社',
  '品牌',
  '放送开始',
  '连载开始',
  '发售日',
  '発売日',
  '开始'
]
const priorityKeys = computed<string[]>(() => {
  const c = props.subject?.category
  return PRIORITY_BY_CATEGORY[c as string] ?? DEFAULT_PRIORITY
})

// 点击标签 → 在 app 内弹出该标签作品悬浮窗（离线 Archive 按标签过滤，秒显）
function openTag(tag: string) {
  entity.openTag(tag)
}

// ---------- 制作信息人名跳转：拉取 staff 并按「名字」匹配，把 dd 渲染成可点击项 ----------
// 复用组件已有的 isBangumi / providerSubjectId 计算（无需上层传 id）。
const bangumiId = computed<number | null>(() =>
  isBangumi.value && providerSubjectId.value ? Number(providerSubjectId.value) : null
)
const persons = ref<SubjectPerson[]>([])
watch(
  bangumiId,
  async (id) => {
    persons.value = []
    if (!id) return
    try {
      persons.value = await subjectClient.getPersons(id)
    } catch (e) {
      console.warn('[SubjectMetaPanel] 获取制作人员失败（制作信息人名跳转降级为纯文本）：', e)
      persons.value = []
    }
  },
  { immediate: true }
)

// 名字（含中文名）→ 人物 id，供制作信息 value 匹配。
const personByName = computed<Map<string, number>>(() => {
  const m = new Map<string, number>()
  for (const p of persons.value) {
    if (p.name) m.set(p.name, p.id)
    if (p.nameCn) m.set(p.nameCn, p.id)
  }
  return m
})

// 把制作信息 value 拆成「可点击片段 + 普通文本」片段，便于按人名/公司名跳转到人物卡。
// 优先整段精确匹配（单个人名/公司名最常见）；否则按分隔符拆分逐段匹配（处理「甲、乙」多值）。
function segmentValue(value: string): { text: string; personId?: number }[] {
  const map = personByName.value
  if (map.has(value)) return [{ text: value, personId: map.get(value)! }]
  const parts = value.split(/([、，,/／]+)/) // 保留分隔符为独立片段
  const segs: { text: string; personId?: number }[] = []
  for (const part of parts) {
    if (!part) continue
    if (/^[、，,/／]+$/.test(part)) {
      segs.push({ text: part })
      continue
    }
    segs.push({ text: part, personId: map.get(part) })
  }
  return segs
}
function segOf(value: string): { text: string; personId?: number }[] {
  return segmentValue(value)
}

// 点击人名/公司名 → 打开对应人物卡（悬浮窗内用 push 以支持侧键回退，详情页用 open 替换）。
function openPerson(id: number) {
  if (props.pushNav) entity.push('person', id, [])
  else entity.open('person', id, [])
}

const collapsedMeta = computed<SubjectMeta[]>(() => {
  const all = meta()
  const pri = all.filter((m) => priorityKeys.value.includes(m.key))
  return pri.length ? pri : all.slice(0, 2)
})
</script>

<template>
  <section class="panel meta-panel">
    <h3>评分 / 标签 / 制作信息</h3>

    <div class="cards">
      <!-- 评分卡片：左侧=我的评价(上) + Bangumi 评分(下)，中间竖线，右侧暂留空 -->
      <div class="card-box rating-card">
        <div class="card-head">
          <span class="card-title">评分</span>
        </div>
        <div class="rating-split">
          <div class="rating-left">
            <div class="rating-my" v-if="isBangumi">
              <div class="rating-my-head">
                <span class="rating-my-label">我的评价</span>
                <span v-if="hoverLabel" class="rating-my-hover-label">{{ hoverLabel }}</span>
              </div>
              <div class="rating-my-stars">
                <button
                  type="button"
                  class="rating-star-btn"
                  v-for="n in 10"
                  :key="n"
                  :class="{ 'is-active': displayRating != null && n <= displayRating }"
                  :aria-label="`评分 ${n}`"
                  @click="setMyRating(n)"
                  @mouseenter="hoverRating = n"
                  @mouseleave="hoverRating = null"
                >★</button>
              </div>
            </div>
            <div class="rating-divider-h" v-if="isBangumi"></div>
              <div class="rating rating-bgm">
                <span class="star">★</span>
                <span v-if="rating() != null" class="score">{{ rating()?.toFixed(1) }}</span>
                <span v-else class="score score--empty">—</span>
                <span v-if="rating() != null" class="rating-bgm-label">{{ bgmRatingLabel }}</span>
              <span v-if="rating() == null" class="rating-hint">暂无评分</span>
            </div>
            <div class="rating-bgm-rank" v-if="rankNum">
              Bangumi {{ rankTypeWord }} Ranked:<span class="rank-num">#{{ rankNum }}</span>
            </div>
          </div>
          <div class="rating-divider-v"></div>
          <div class="rating-right">
            <div class="dist" v-if="ratingCount">
              <div class="dist-head">
                <span>评分分布</span>
                <span class="dist-total">{{ ratingTotal }} 人评分</span>
              </div>
              <div class="dist-bars">
                <div class="dist-col" v-for="d in ratingDist" :key="d.star">
                  <div class="dist-bar-wrap">
                    <div
                      class="dist-bar"
                      :style="{ height: barHeight(d.count) }"
                      :title="`${d.star} 星：${d.count} 票`"
                    >
                      <span class="dist-tip">{{ distPct(d.count) }}% ({{ d.count }}人)</span>
                    </div>
                  </div>
                  <span class="dist-x">{{ d.star }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 标签卡片（含官方标签：官方标签带一圈描边并排在最前，用户自由标签随后） -->
      <div class="card-box tags-card">
        <div class="card-head">
          <span class="card-title">标签</span>
          <span v-if="officialTags().length + userTags().length" class="card-count">{{ officialTags().length + userTags().length }}</span>
        </div>
        <div v-if="officialTags().length + userTags().length" class="tags">
          <!-- 官方/系统标签（Bangumi meta_tags）：与普通标签同款，仅边框为浅粉，排在最前；有同名用户标注次数则显示 -->
          <button
            type="button"
            class="tag tag--link tag--official"
            v-for="m in officialTags()"
            :key="'official-' + m"
            :title="`官方标签：${m}`"
            @click="openTag(m)"
          >{{ m }}<small v-if="officialCount(m)">·{{ officialCount(m) }}</small></button>
          <!-- 用户自由标注标签（排除已作为官方展示的，避免重复） -->
          <button
            type="button"
            class="tag tag--link"
            v-for="t in userTags()"
            :key="t.name"
            :title="`查看标签：${t.name}`"
            @click="openTag(t.name)"
          >
            {{ t.name }}<small v-if="t.count">·{{ t.count }}</small>
          </button>
        </div>
        <p v-else class="card-empty">暂无标签</p>
      </div>

      <!-- 制作信息卡片（默认折叠，仅显示制作公司/导演；点击展开看全部） -->
      <div class="card-box meta-card">
        <div class="card-head">
          <span class="card-title">制作信息</span>
          <div class="head-actions">
            <button
              v-if="meta().length"
              class="expand-btn"
              @click="metaExpanded = !metaExpanded"
            >
              {{ metaExpanded ? '收起 ▲' : '展开 ▼' }}
            </button>
          </div>
        </div>

        <template v-if="meta().length">
          <!-- 折叠态：仅核心制作信息 -->
          <dl v-if="!metaExpanded" class="meta-list">
            <div class="meta-row" v-for="m in collapsedMeta" :key="m.key">
              <dt>{{ m.key }}</dt>
              <dd>
                <span class="meta-seg" v-for="(seg, i) in segOf(m.value)" :key="i">
                  <span
                    v-if="seg.personId != null"
                    class="meta-link"
                    role="button"
                    tabindex="0"
                    :title="`查看 ${seg.text} 的资料`"
                    @click="openPerson(seg.personId)"
                    @keydown.enter.prevent="openPerson(seg.personId)"
                    @keydown.space.prevent="openPerson(seg.personId)"
                    >{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </span>
              </dd>
            </div>
            <p v-if="meta().length > collapsedMeta.length" class="more-hint">
              还有 {{ meta().length - collapsedMeta.length }} 项，点击「展开」查看
            </p>
          </dl>
          <!-- 展开态：全部 -->
          <dl v-else class="meta-list">
            <div class="meta-row" v-for="m in meta()" :key="m.key">
              <dt>{{ m.key }}</dt>
              <dd>
                <span class="meta-seg" v-for="(seg, i) in segOf(m.value)" :key="i">
                  <span
                    v-if="seg.personId != null"
                    class="meta-link"
                    role="button"
                    tabindex="0"
                    :title="`查看 ${seg.text} 的资料`"
                    @click="openPerson(seg.personId)"
                    @keydown.enter.prevent="openPerson(seg.personId)"
                    @keydown.space.prevent="openPerson(seg.personId)"
                    >{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </span>
              </dd>
            </div>
          </dl>
        </template>
        <p v-else class="card-empty">暂无制作信息</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.meta-panel {
  margin: 0;
}
.meta-panel h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

/* 三张卡片上下排列（评分 / 标签 / 制作信息），卡片间距减半 */
.cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card-box {
  background: var(--bg-elev, #1c2230);
  border: 1px solid var(--border, #2a3342);
  border-radius: 10px;
  padding: 12px 14px;
}
.rating-card {
  position: relative;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #e6e9ef);
}
.card-count {
  font-size: 11px;
  color: var(--text-dim, #8b94a3);
  background: var(--bg, #11151d);
  border: 1px solid var(--border, #2a3342);
  border-radius: 999px;
  padding: 1px 8px;
}
.card-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, #8b94a3);
}

/* 评分卡片 */
.rating {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rating .star {
  color: var(--rating-color, #f7b500);
  font-size: 20px;
  line-height: 1;
}
.rating .score {
  font-size: 20px;
  font-weight: 700;
  color: var(--rating-color, #f7b500);
}
.rating .score--empty {
  color: var(--text-dim, #8b94a3);
  font-weight: 500;
}
.rating-bgm-label {
  margin-left: 2px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-dim, #8b94a3);
}
.rating-hint {
  font-size: 11px;
  color: var(--text-dim, #8b94a3);
}
.rating-hint--loading {
  color: var(--accent, #f09199);
}

/* 评分卡片：左右分栏（左=我的评价/ Bangumi；右=暂留空）+ 左半上下分栏 */
.rating-split {
  display: flex;
  align-items: stretch;
}
.rating-left {
  flex: 1 1 50%;
  display: grid;
  grid-template-rows: auto auto auto auto;
  align-content: center;
  min-height: 120px;
  min-width: 0;
  padding-right: 12px;
}
.rating-my {
  grid-row: 1;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transform: translateY(-10px);
}
.rating-my-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim, #8b94a3);
}
.rating-my-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.rating-my-hover-label {
  font-size: 12px;
  font-weight: 700;
  color: #ff5a5a;
}
.rating-my-stars {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
.rating-star-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  color: var(--text-dim, #8b94a3);
  transition: color 0.12s, transform 0.1s;
}
.rating-star-btn:hover {
  transform: scale(1.12);
}
.rating-star-btn.is-active {
  color: var(--rating-color, #f7b500);
}
.rating-divider-h {
  grid-row: 2;
  height: 0;
  border-top: 1px solid var(--border, #2a3342);
  margin: 0;
}
.rating-bgm {
  grid-row: 3;
  align-self: center;
  align-items: baseline;
}
.rating-bgm-rank {
  grid-row: 4;
  font-size: 12px;
  line-height: 1.2;
  color: var(--text-dim, #8b94a3);
  margin-top: 2px;
}
.rating-bgm-rank .rank-num {
  color: var(--text, #e6e9ef);
  font-weight: 600;
}
.rating-divider-v {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border, #2a3342);
}
.rating-right {
  flex: 1 1 50%;
  min-width: 0;
  padding-left: 12px;
}
.dist {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.dist-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim, #8b94a3);
  margin-bottom: 6px;
  transform: translateY(-20px);
}
.dist-total {
  font-size: 11px;
  font-weight: 400;
}
.dist-bars {
  flex: 1 1 auto;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  min-height: 96px;
}
.dist-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.dist-bar-wrap {
  flex: 1 1 auto;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.dist-bar {
  position: relative;
  width: 100%;
  max-width: 16px;
  background: #3a4150;
  border-radius: 2px 2px 0 0;
  min-height: 2px;
  transition: height 0.2s ease, background 0.15s ease;
}
:root[data-theme="light"] .dist-bar {
  background: #828996;
}
.dist-col:hover .dist-bar {
  background: var(--rating-color, #f7b500);
}
.dist-tip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  padding: 3px 7px;
  background: rgba(16, 20, 28, 0.96);
  color: #fff;
  border: 1px solid var(--border, #2a3342);
  border-radius: 5px;
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 20;
}
.dist-col:hover .dist-tip {
  opacity: 1;
}
.dist-x {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-dim, #8b94a3);
  line-height: 1;
}

/* 标签 */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg, #11151d);
  border: 1px solid var(--border, #3a4554);
  font-size: 12px;
  color: var(--text, #e6e9ef);
}
.tag--link {
  cursor: pointer;
  font: inherit;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.tag--link:hover {
  color: var(--text, #e6e9ef);
  border-color: var(--accent, #f09199);
  background: var(--bg-elev, #1c2230);
}
.tag small {
  color: var(--text-dim, #8b94a3);
  font-size: 10px;
}
/* 官方/系统标签：与普通标签同款样式，仅边框改为浅粉以作区分 */
.tag--official {
  border-color: #f5b9be;
}

/* 制作信息列表 */
.meta-list {
  margin: 0;
  display: grid;
  gap: 4px;
  line-height: 1.5;
}
.meta-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 10px;
  font-size: 13px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--border, #2c333d);
}
.meta-row dt {
  color: var(--text-dim, #8b94a3);
  flex-shrink: 0;
}
.meta-row dd {
  margin: 0;
  color: var(--text, #e6e9ef);
  word-break: break-word;
}
/* 制作信息里的人名/公司名：可点击跳人物卡（用 span 而非 button，避免长文本无法断行） */
.meta-seg {
  display: inline;
}
.meta-link {
  display: inline;
  color: var(--accent, #f09199);
  cursor: pointer;
  word-break: break-word;
  overflow-wrap: anywhere;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s, color 0.15s;
}
.meta-link:hover,
.meta-link:focus-visible {
  border-bottom-color: currentColor;
  outline: none;
}
.more-hint {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-dim, #8b94a3);
}

/* 头部操作按钮 */
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.expand-btn {
  font-size: 11px;
  color: var(--text-dim, #8b97a8);
  background: var(--bg, #11151d);
  border: 1px solid var(--border, #2a3342);
  border-radius: 999px;
  padding: 2px 9px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.expand-btn:hover {
  color: var(--text, #e6e9ef);
  border-color: var(--accent, #f09199);
  background: var(--bg-elev-hover, #2c3440);
}
</style>
