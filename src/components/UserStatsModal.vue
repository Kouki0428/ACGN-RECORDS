<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UserStats, StatsSnapshot } from '@shared/types'

const props = defineProps<{
  visible: boolean
  stats: UserStats | null
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

type TabKey = 'all' | 'light_novel' | 'manga' | 'anime' | 'game'
const tab = ref<TabKey>('all')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'anime', label: '动画' },
  { key: 'light_novel', label: '小说' },
  { key: 'manga', label: '漫画' },
  { key: 'game', label: '游戏' }
]

const current = computed(() => props.stats?.[tab.value] ?? null)

const fmtPct = (v: number) => (v * 100).toFixed(1) + '%'
const fmt2 = (v: number | null) => (v == null ? '—' : v.toFixed(2))

// 评分分布：histogram 长度 11，取 score=10..1（10 分在前）；pct 为该分数占已评分作品的比例
const bars = computed(() => {
  const h = current.value?.histogram ?? new Array(11).fill(0)
  const total = h.slice(1, 11).reduce((s, x) => s + (x ?? 0), 0)
  const arr: { score: number; count: number; pct: number }[] = []
  for (let s = 10; s >= 1; s--) {
    const c = h[s] ?? 0
    arr.push({ score: s, count: c, pct: total ? (c / total) * 100 : 0 })
  }
  return arr
})
const maxHist = computed(() => Math.max(1, ...bars.value.map((b) => b.count)))

const barColor = (score: number) =>
  score >= 8 ? '#f7b500' : score >= 6 ? '#7ed0a8' : score >= 4 ? '#6ab7ff' : '#ff7a7a'

// ===== 历史趋势（月度快照折线）=====
const history = ref<StatsSnapshot[]>([])
watch(
  () => props.visible,
  async (v) => {
    if (!v || history.value.length) return
    try {
      const r = (await window.acgn.statsSnapshotHistory?.(12)) as StatsSnapshot[] | undefined
      if (Array.isArray(r)) history.value = r
    } catch {
      /* 趋势图失败不影响统计主体 */
    }
  }
)
const trend = computed(() => history.value.filter((s) => s.total > 0))
/** 折线点坐标（viewBox 0..300 x 0..96，留 padding） */
const trendPts = computed(() => {
  const arr = trend.value
  if (arr.length < 2) return []
  const max = Math.max(...arr.map((s) => s.total))
  return arr.map((s, i) => ({
    x: 8 + (i * 284) / (arr.length - 1),
    y: 88 - (s.total / max) * 76,
    total: s.total,
    done: s.done,
    month: s.month.slice(2) // 26-08 形式
  }))
})
const trendPath = computed(() => trendPts.value.map((p) => `${p.x},${p.y}`).join(' '))
const trendArea = computed(() =>
  trendPts.value.length
    ? `M ${trendPts.value[0].x},92 L ${trendPath.value.replace(/ /g, ' L ')} L ${trendPts.value[trendPts.value.length - 1].x},92 Z`
    : ''
)

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="us-overlay">
      <div v-if="visible" class="us-overlay" @click="close">
        <div class="us-modal" @click.stop>
          <div class="us-head">
            <span class="us-title">数据统计</span>
            <button class="us-close" type="button" title="关闭" aria-label="关闭" @click="close">
              ×
            </button>
          </div>

          <div class="us-tabs">
            <button
              v-for="t in tabs"
              :key="t.key"
              type="button"
              class="us-tab"
              :class="{ active: tab === t.key }"
              @click="tab = t.key"
            >
              {{ t.label }}
            </button>
          </div>

          <div v-if="current" class="us-body">
            <!-- 历史趋势（≥2 个月快照时显示） -->
            <div v-if="trendPts.length >= 2" class="us-trend">
              <div class="us-trend-head">收藏趋势（近 {{ trendPts.length }} 个月）</div>
              <svg viewBox="0 0 300 100" class="us-trend-svg" preserveAspectRatio="none">
                <path :d="trendArea" fill="rgba(91,157,255,0.14)" stroke="none"></path>
                <polyline
                  :points="trendPath"
                  fill="none"
                  stroke="#5b9dff"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                ></polyline>
                <circle
                  v-for="(p, i) in trendPts"
                  :key="i"
                  :cx="p.x"
                  :cy="p.y"
                  r="3"
                  fill="#5b9dff"
                >
                  <title>{{ p.month }}：收藏 {{ p.total }} / 完成 {{ p.done }}</title>
                </circle>
              </svg>
              <div class="us-trend-x">
                <span v-for="p in trendPts" :key="p.month">{{ p.month }}</span>
              </div>
            </div>

            <div class="us-cards">
              <div class="us-card">
                <div class="us-card-num">{{ current.total }}</div>
                <div class="us-card-label">收藏</div>
              </div>
              <div class="us-card">
                <div class="us-card-num">{{ current.done }}</div>
                <div class="us-card-label">完成</div>
              </div>
              <div class="us-card">
                <div class="us-card-num">{{ fmtPct(current.completionRate) }}</div>
                <div class="us-card-label">完成率</div>
              </div>
              <div class="us-card">
                <div class="us-card-num">{{ fmt2(current.avgRating) }}</div>
                <div class="us-card-label">平均分</div>
              </div>
              <div class="us-card">
                <div class="us-card-num">{{ fmt2(current.stdRating) }}</div>
                <div class="us-card-label">标准差</div>
              </div>
              <div class="us-card">
                <div class="us-card-num">{{ current.ratedCount }}</div>
                <div class="us-card-label">评分数</div>
              </div>
            </div>

            <div
              class="us-spent"
              :class="{ 'us-spent--empty': !(tab === 'game' && current.totalSpent > 0) }"
            >
              <span class="us-spent-label">总花费</span>
              <span class="us-spent-num"
                >¥{{
                  current.totalSpent > 0
                    ? current.totalSpent.toLocaleString('zh-CN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })
                    : '0.00'
                }}</span
              >
            </div>

            <div class="us-chart">
              <div class="us-bars">
                <div v-for="b in bars" :key="b.score" class="us-bar-col">
                  <div class="us-bar-track">
                    <div class="us-bar-tip">{{ b.pct.toFixed(1) }}%（{{ b.count }}）</div>
                    <div
                      class="us-bar-fill"
                      :style="{
                        height: (b.count / maxHist) * 100 + '%',
                        background: barColor(b.score)
                      }"
                    ></div>
                  </div>
                  <div class="us-bar-label">{{ b.score }}</div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="us-empty">暂无收藏数据</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.us-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1300;
}
.us-modal {
  width: min(440px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  background: var(--bg-elev, #1c2230);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  padding: 18px 20px 22px;
  color: var(--text);
}
.us-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.us-title {
  font-size: 17px;
  font-weight: 700;
}
.us-close {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.us-close:hover {
  background: var(--accent);
  color: #fff;
}
.us-close:active {
  background: #ff3d77;
  color: #fff;
  transform: scale(0.94);
}
.us-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.us-tab {
  flex: 1;
  padding: 7px 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13.5px;
  transition: all 0.15s;
}
.us-tab.active {
  color: #fff;
  background: var(--accent-2, #5b9dff);
  border-color: var(--accent-2, #5b9dff);
}
.us-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
.us-card {
  background: var(--bg-deep, #14171c);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 10px;
  text-align: center;
}
.us-card-num {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--text);
}
.us-card-label {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-dim);
}
/* 游戏分类专属：卡片网格下方的累计花费金额条 */
.us-spent {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: -14px 0 18px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-deep, #14171c);
}
.us-spent-label {
  font-size: 13px;
  color: var(--text-dim);
}
.us-spent-num {
  font-size: 20px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--accent-2, #5b9dff);
  font-variant-numeric: tabular-nums;
}
/* 非游戏栏/无花费时：保留与游戏栏完全相同的高度，避免切换 tab 悬浮窗高度突变；
   内容不可见、边框背景不绘制，视觉上为空位。 */
.us-spent--empty {
  visibility: hidden;
}
.us-card-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--accent-2, #5b9dff);
}
.us-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 150px;
}
.us-bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.us-bar-track {
  position: relative;
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.us-bar-fill {
  width: 70%;
  min-height: 2px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: height 0.3s;
}
.us-bar-tip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: var(--bg-deep, #14171c);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 2;
}
.us-bar-col:hover .us-bar-tip {
  opacity: 1;
}
.us-bar-label {
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-dim);
}
.us-empty {
  text-align: center;
  color: var(--text-dim);
  padding: 30px 0;
}
/* ===== 历史趋势折线 ===== */
.us-trend {
  margin-bottom: 16px;
  background: var(--bg-deep, #14171c);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.us-trend-head {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.us-trend-svg {
  width: 100%;
  height: 96px;
  display: block;
}
.us-trend-x {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--text-dim);
}
.us-overlay-enter-active,
.us-overlay-leave-active {
  transition: opacity 0.2s;
}
.us-overlay-enter-from,
.us-overlay-leave-to {
  opacity: 0;
}
</style>
