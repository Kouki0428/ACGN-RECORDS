import type { Category } from '@shared/types'

export interface StatusTab {
  status: number
  label: string
}

// Bangumi 收藏状态：1=想看/想读/想玩，2=看过/读过/玩过，3=在看/在读/在玩，4=搁置，5=抛弃
const MAP: Record<Category, StatusTab[]> = {
  anime: [
    { status: 3, label: '在看' },
    { status: 2, label: '看过' },
    { status: 1, label: '想看' },
    { status: 4, label: '搁置' },
    { status: 5, label: '抛弃' }
  ],
  manga: [
    { status: 3, label: '在读' },
    { status: 2, label: '读过' },
    { status: 1, label: '想读' },
    { status: 4, label: '搁置' },
    { status: 5, label: '抛弃' }
  ],
  light_novel: [
    { status: 3, label: '在读' },
    { status: 2, label: '读过' },
    { status: 1, label: '想读' },
    { status: 4, label: '搁置' },
    { status: 5, label: '抛弃' }
  ],
  galgame: [
    { status: 3, label: '在玩' },
    { status: 2, label: '玩过' },
    { status: 1, label: '想玩' },
    { status: 4, label: '搁置' },
    { status: 5, label: '抛弃' }
  ]
}

export function statusTabs(category: Category): StatusTab[] {
  return MAP[category] ?? MAP.anime
}

export function statusLabel(category: Category, status: number): string {
  return statusTabs(category).find((t) => t.status === status)?.label ?? ''
}
