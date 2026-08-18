<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/services/apiClient'
import { animeClient } from '@/services/animeClient'
import { collectionClient } from '@/services/collectionClient'
import type { Subject, Category, SearchQuery, SearchResultItem } from '@shared/types'
import CoverImage from '@/components/CoverImage.vue'

const route = useRoute()
const router = useRouter()

const keyword = ref<string>((route.query.q as string) || '')
const results = ref<Subject[]>([])
const searching = ref(false)
const failed = ref('')
// 已添加的作品（providerSubjectId），用于把按钮置为“已添加 ✓”并禁用，便于连续添加多部
const added = ref<Set<string>>(new Set())

const CAT_LABELS: Record<Category, string> = {
  anime: '动画',
  light_novel: '小说',
  manga: '漫画',
  galgame: '游戏'
}
const ROUTE_BY_CAT: Record<Category, string> = {
  anime: '/anime',
  light_novel: '/light-novel',
  manga: '/manga',
  galgame: '/galgame'
}

async function doSearch(q: string) {
  const kw = (q || '').trim()
  if (!kw) {
    results.value = []
    return
  }
  searching.value = true
  failed.value = ''
  try {
    const list = await apiClient.search({ keyword: kw, domain: 'subject', subjectType: 'all' })
    results.value = list
      .filter((r): r is Extract<SearchResultItem, { kind: 'subject' }> => r.kind === 'subject')
      .map((r) => r.subject)
  } catch (e) {
    failed.value = '检索失败：' + (e instanceof Error ? e.message : String(e))
    results.value = []
  } finally {
    searching.value = false
  }
}

onMounted(() => doSearch(keyword.value))
watch(
  () => route.query.q,
  (q) => {
    keyword.value = (q as string) || ''
    doSearch(keyword.value)
  }
)

async function add(subject: Subject) {
  if (added.value.has(subject.providerSubjectId)) return
  try {
    if (subject.category === 'anime') {
      await animeClient.addToWatching(subject)
    } else {
      await collectionClient.add(subject, 3)
    }
    const next = new Set(added.value)
    next.add(subject.providerSubjectId)
    added.value = next
  } catch (e) {
    failed.value = '添加失败：' + (e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="search-page">
    <h1>搜索“{{ keyword }}”</h1>

    <div v-if="searching" class="placeholder">检索中…</div>
    <div v-else-if="failed" class="placeholder">{{ failed }}</div>
    <div v-else-if="results.length === 0" class="placeholder">
      没有找到与“{{ keyword }}”相关的作品。
    </div>

    <div v-else class="grid">
      <div v-for="s in results" :key="s.provider + ':' + s.providerSubjectId" class="card">
        <CoverImage :src="s.imageUrl" :alt="s.title" class="card-cover" />
        <div class="title">{{ s.titleCn || s.title }}</div>
        <span class="cat-badge" :class="'cat-' + s.category">{{ CAT_LABELS[s.category] }}</span>
        <button
          class="btn btn--primary btn--block"
          :disabled="added.has(s.providerSubjectId)"
          @click="add(s)"
        >
          {{ added.has(s.providerSubjectId) ? '已添加 ✓' : '添加到' + CAT_LABELS[s.category] }}
        </button>
        <button class="btn btn--ghost btn--block" @click="router.push(ROUTE_BY_CAT[s.category])">
          查看栏目
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-page {
  padding: 4px 2px;
}
.cat-badge {
  display: inline-block;
  align-self: flex-start;
  margin: 2px 0 8px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}
.cat-badge.cat-anime {
  background: #5b9dff;
}
.cat-badge.cat-light_novel {
  background: #57c08d;
}
.cat-badge.cat-manga {
  background: #e0853e;
}
.cat-badge.cat-galgame {
  background: #b06fd8;
}
.btn--block {
  width: 100%;
  margin-top: 6px;
}
</style>
