import { defineStore } from 'pinia'
import { ref } from 'vue'
import { dbClient } from '@/services/dbClient'

// 用户收藏 / 进度的本地状态（与 collections 表对应）
export const useCollectionsStore = defineStore('collections', () => {
  const items = ref<any[]>([])

  async function load(category?: string) {
    const sql = category
      ? `SELECT c.*, s.title, s.title_cn, s.category
         FROM collections c JOIN subjects s ON s.id = c.subject_id
         WHERE s.category = ? ORDER BY c.local_updated_at DESC`
      : `SELECT c.*, s.title, s.title_cn, s.category
         FROM collections c JOIN subjects s ON s.id = c.subject_id
         ORDER BY c.local_updated_at DESC`
    items.value = await dbClient.query(sql, category ? [category] : [])
  }

  return { items, load }
})
