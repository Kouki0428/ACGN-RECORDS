import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dbClient } from '@/services/dbClient'

// 跨模块统计：从 collections / episode_progress 派生
function currentSeason(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (m <= 3) return { start: `${y}-01-01`, end: `${y}-03-31` }
  if (m <= 6) return { start: `${y}-04-01`, end: `${y}-06-30` }
  if (m <= 9) return { start: `${y}-07-01`, end: `${y}-09-30` }
  return { start: `${y}-10-01`, end: `${y}-12-31` }
}

export const useStatisticsStore = defineStore('statistics', () => {
  const watchingThisSeason = ref(0)
  const totalEpisodesWatched = ref(0)
  const totalSpent = ref(0)

  const summary = computed(() => ({
    watchingThisSeason: watchingThisSeason.value,
    totalEpisodesWatched: totalEpisodesWatched.value,
    totalSpent: totalSpent.value
  }))

  async function refresh() {
    const { start, end } = currentSeason()
    const seasonRows = await dbClient.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM collections c
       JOIN subjects s ON s.id = c.subject_id
       WHERE c.status = 3 AND s.category = 'anime'
         AND s.air_date BETWEEN ? AND ?`,
      [start, end]
    )
    watchingThisSeason.value = seasonRows[0]?.n ?? 0

    const epRows = await dbClient.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM episode_progress WHERE watched = 1`
    )
    totalEpisodesWatched.value = epRows[0]?.n ?? 0

    const spentRows = await dbClient.query<{ s: number }>(
      `SELECT COALESCE(SUM(price),0) AS s FROM purchases`
    )
    totalSpent.value = spentRows[0]?.s ?? 0
  }

  return { watchingThisSeason, totalEpisodesWatched, totalSpent, summary, refresh }
})
