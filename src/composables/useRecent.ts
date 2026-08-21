import { ref } from 'vue'

// 搜索历史 + 最近浏览作品（模块级单例，localStorage 持久化）。
// 纯渲染层能力，不涉及主进程；读写均 try/catch 包裹（隐私模式/配额满时静默降级）。

const SEARCH_KEY = 'acgn-search-history'
const SUBJECT_KEY = 'acgn-recent-subjects'
const MAX_TERMS = 10
const MAX_SUBJECTS = 12

export interface RecentSubject {
  /** Bangumi provider subject id */
  id: number
  title: string
  image: string | null
  at: number
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

const searchHistory = ref<string[]>(loadJson<string[]>(SEARCH_KEY, []))
const recentSubjects = ref<RecentSubject[]>(loadJson<RecentSubject[]>(SUBJECT_KEY, []))

/** 记录一次搜索词（去重置顶，最多 MAX_TERMS 条） */
function pushSearchTerm(term: string) {
  const t = term.trim()
  if (!t) return
  const next = [t, ...searchHistory.value.filter((x) => x !== t)].slice(0, MAX_TERMS)
  searchHistory.value = next
  saveJson(SEARCH_KEY, next)
}

function removeSearchTerm(term: string) {
  const next = searchHistory.value.filter((x) => x !== term)
  searchHistory.value = next
  saveJson(SEARCH_KEY, next)
}

function clearSearchHistory() {
  searchHistory.value = []
  saveJson(SEARCH_KEY, [])
}

/** 记录一次作品浏览（按 id 去重置顶，最多 MAX_SUBJECTS 部） */
function pushRecentSubject(id: number, title: string, image: string | null) {
  if (!Number.isFinite(id) || id <= 0) return
  const rest = recentSubjects.value.filter((x) => x.id !== id)
  const next = [{ id, title, image: image ?? null, at: Date.now() }, ...rest].slice(0, MAX_SUBJECTS)
  recentSubjects.value = next
  saveJson(SUBJECT_KEY, next)
}

function clearRecentSubjects() {
  recentSubjects.value = []
  saveJson(SUBJECT_KEY, [])
}

export function useRecent() {
  return {
    searchHistory,
    recentSubjects,
    pushSearchTerm,
    removeSearchTerm,
    clearSearchHistory,
    pushRecentSubject,
    clearRecentSubjects
  }
}
