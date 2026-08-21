<script setup lang="ts">
// 观看活动热力图（GitHub 贡献墙风格）：近一年按天标记次数，
// 颜色深浅用 --accent 的 color-mix 阶梯，悬停显示日期与次数。
import { computed } from 'vue'

const props = defineProps<{ data: { day: string; count: number }[] }>()

interface Cell {
  key: string
  count: number
  future: boolean
}

const countMap = computed(() => new Map(props.data.map((d) => [d.day, d.count])))
const total = computed(() => props.data.reduce((s, d) => s + d.count, 0))

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 生成 53 周网格：起点=364 天前对齐到周一；末尾不足一周补 future 空格
const weeks = computed<Cell[][]>(() => {
  const out: Cell[][] = []
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // 对齐周一
  const cur = new Date(start)
  let col: Cell[] = []
  while (cur <= end) {
    const key = fmt(cur)
    col.push({ key, count: countMap.value.get(key) ?? 0, future: false })
    if (col.length === 7) {
      out.push(col)
      col = []
    }
    cur.setDate(cur.getDate() + 1)
  }
  if (col.length) {
    while (col.length < 7) col.push({ key: '', count: 0, future: true })
    out.push(col)
  }
  return out
})

function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

function title(c: Cell): string {
  if (c.future || !c.key) return ''
  const n = c.count
  return `${c.key}：${n} 次标记`
}
</script>

<template>
  <div class="hm">
    <div class="hm-grid">
      <div v-for="(w, wi) in weeks" :key="wi" class="hm-col">
        <div
          v-for="c in w"
          :key="c.key || wi + '-' + c.future"
          class="hm-cell"
          :class="[`lv${level(c.count)}`, { future: c.future }]"
          :title="title(c)"
        ></div>
      </div>
    </div>
    <div class="hm-foot">
      <span>近一年共 <b>{{ total }}</b> 次标记</span>
      <span class="hm-scale">
        少
        <i v-for="l in 5" :key="l" class="hm-cell" :class="`lv${l - 1}`"></i>
        多
      </span>
    </div>
  </div>
</template>

<style scoped>
.hm-grid {
  display: flex;
  gap: 3px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.hm-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hm-cell {
  width: 11px;
  height: 11px;
  border-radius: 2.5px;
  background: var(--bg-elev);
  flex-shrink: 0;
}
.hm-cell.future {
  visibility: hidden;
}
.hm-cell.lv1 {
  background: color-mix(in srgb, var(--accent) 28%, var(--bg-elev));
}
.hm-cell.lv2 {
  background: color-mix(in srgb, var(--accent) 50%, var(--bg-elev));
}
.hm-cell.lv3 {
  background: color-mix(in srgb, var(--accent) 72%, var(--bg-elev));
}
.hm-cell.lv4 {
  background: var(--accent);
}
.hm-cell:not(.future):hover {
  outline: 1.5px solid var(--text-dim);
}
.hm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.hm-foot b {
  color: var(--text);
}
.hm-scale {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.hm-scale .hm-cell {
  width: 10px;
  height: 10px;
}
</style>
