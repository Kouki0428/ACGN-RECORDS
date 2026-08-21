<script setup lang="ts">
// 年度报告：聚合本地数据（标记集数/活跃收藏/月度活跃/分类分布/高分佳作），
// 数据全部来自本地 SQLite（collection:annualReport），无网络依赖。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AnnualReport } from '@shared/types'

const router = useRouter()
const report = ref<AnnualReport | null>(null)
const loading = ref(true)

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

onMounted(async () => {
  try {
    report.value = (await window.acgn.annualReport()) as AnnualReport
  } finally {
    loading.value = false
  }
})

const maxMonthly = computed(() => Math.max(1, ...(report.value?.monthly ?? [0])))
const totalDelta = computed(() => {
  const r = report.value
  if (!r || r.totalStart == null || r.totalNow == null) return null
  return r.totalNow - r.totalStart
})
const distMax = computed(() => Math.max(1, ...(report.value?.categories ?? []).map((c) => c.count)))
</script>

<template>
  <div class="annual">
    <header class="view-head">
      <button class="back-btn" type="button" aria-label="返回" @click="router.push('/personal')">
        <svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg>
      </button>
      <h1>年度报告{{ report ? ` · ${report.year}` : '' }}</h1>
    </header>

    <div v-if="loading" class="placeholder">统计中…</div>

    <template v-else-if="report">
      <!-- 核心数字卡 -->
      <section class="panel ar-cards">
        <div class="ar-card">
          <div class="ar-num">{{ report.episodesMarked }}</div>
          <div class="ar-label">本年标记集数</div>
        </div>
        <div class="ar-card">
          <div class="ar-num">{{ report.activeCollections }}</div>
          <div class="ar-label">有活动的收藏</div>
        </div>
        <div class="ar-card">
          <div class="ar-num">
            {{ totalDelta == null ? '—' : (totalDelta >= 0 ? '+' : '') + totalDelta }}
          </div>
          <div class="ar-label">收藏净增（年初至今）</div>
        </div>
        <div class="ar-card">
          <div class="ar-num">{{ report.totalNow ?? '—' }}</div>
          <div class="ar-label">当前总收藏</div>
        </div>
      </section>

      <!-- 月度活跃 -->
      <section class="panel">
        <h2>月度活跃</h2>
        <div class="ar-months">
          <div v-for="(v, i) in report.monthly" :key="i" class="ar-mcol" :title="`${MONTHS[i]}：${v} 次`">
            <span class="ar-mnum" v-if="v > 0">{{ v }}</span>
            <div class="ar-mbar-track"><div class="ar-mbar" :style="{ height: (v / maxMonthly) * 100 + '%' }"></div></div>
            <div class="ar-mlabel">{{ i + 1 }}</div>
          </div>
        </div>
      </section>

      <!-- 分类分布 -->
      <section class="panel">
        <h2>收藏构成</h2>
        <div class="ar-dist">
          <div v-for="c in report.categories" :key="c.key" class="ar-drow">
            <span class="ar-dlabel">{{ c.label }}</span>
            <div class="ar-dtrack">
              <div class="ar-dfill" :style="{ width: (c.count / distMax) * 100 + '%' }"></div>
            </div>
            <span class="ar-dnum">{{ c.count }}</span>
          </div>
        </div>
      </section>

      <!-- 高分佳作 -->
      <section v-if="report.topRated.length" class="panel">
        <h2>高分佳作 · TOP5</h2>
        <div class="ar-top">
          <button
            v-for="(t, i) in report.topRated"
            :key="i"
            type="button"
            class="ar-trow"
            @click="t.url && router.push('/personal')"
          >
            <span class="ar-trank">#{{ i + 1 }}</span>
            <span class="ar-ttitle">{{ t.title }}</span>
            <span class="ar-tscore">★ {{ t.rating }}</span>
          </button>
        </div>
      </section>
    </template>

    <p v-else class="placeholder">暂无数据</p>
  </div>
</template>

<style scoped>
.ar-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.ar-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px 10px;
  text-align: center;
}
.ar-num {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.15;
  background: var(--accent-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ar-label {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-dim);
}

/* 月度柱状 */
.ar-months {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 160px;
}
.ar-mcol {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  min-width: 0;
}
.ar-mnum {
  font-size: 11px;
  color: var(--text-dim);
}
.ar-mbar-track {
  position: relative;
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ar-mbar {
  width: 62%;
  min-height: 2px;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--bg-elev)));
  transition: height 0.3s var(--ease-out);
}
.ar-mlabel {
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-dim);
}

/* 分类占比横条 */
.ar-dist {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ar-drow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ar-dlabel {
  width: 42px;
  font-size: 13px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.ar-dtrack {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: var(--bg-elev);
  overflow: hidden;
}
.ar-dfill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent-grad);
}
.ar-dnum {
  width: 44px;
  text-align: right;
  font-size: 12.5px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

/* 高分佳作 */
.ar-top {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ar-trow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elev);
  cursor: pointer;
  transition: border-color var(--dur-fast);
}
.ar-trow:hover {
  border-color: var(--accent-2);
}
.ar-trank {
  font-weight: 800;
  color: var(--accent);
  width: 34px;
}
.ar-ttitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  text-align: left;
}
.ar-tscore {
  color: var(--rating-color);
  font-weight: 700;
}
.placeholder {
  color: var(--text-dim);
  padding: 40px 0;
  text-align: center;
}
</style>
