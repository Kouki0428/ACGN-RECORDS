import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Category, Subject, SearchResultItem } from '@shared/types'
import { apiClient } from '@/services/apiClient'

export const useAnimeStore = defineStore('anime', () => {
  const results = ref<Subject[]>([])
  const loading = ref(false)

  async function search(keyword: string, category: Category = 'anime') {
    loading.value = true
    try {
      // 本地 category → 统一搜索的条目子类型
      const subjectType = category === 'anime' ? 'anime' : category === 'galgame' ? 'game' : 'book'
      const list = await apiClient.search({ keyword, domain: 'subject', subjectType })
      results.value = list
        .filter((r): r is Extract<SearchResultItem, { kind: 'subject' }> => r.kind === 'subject')
        .map((r) => r.subject)
    } finally {
      loading.value = false
    }
  }

  return { results, loading, search }
})
