import type { Category } from '@shared/types'

/**
 * 收藏状态中文动词映射（用户要求：动画=看，小说/漫画=读，游戏=玩）。
 * 与 src/utils/statusLabels.ts 的 MAP 保持一致（详情页状态 Tab 同源）。
 * 数组索引 = status-1，顺序固定为 [1=想X, 2=读X过, 3=在X, 4=搁置, 5=抛弃]。
 */
const VERBS: Record<Category, [string, string, string, string, string]> = {
  anime: ['想看', '看过', '在看', '搁置', '抛弃'],
  light_novel: ['想读', '读过', '在读', '搁置', '抛弃'],
  manga: ['想读', '读过', '在读', '搁置', '抛弃'],
  galgame: ['想玩', '玩过', '在玩', '搁置', '抛弃']
}

/** 取某分类下 5 个状态的中文动词（status 1-5 对应下标 0-4） */
export function statusVerbs(category: Category): string[] {
  return VERBS[category] ?? VERBS.anime
}

/** 取某分类下某个状态的中文动词（status 1-5） */
export function statusVerb(category: Category, status: number): string {
  const v = statusVerbs(category)
  return status >= 1 && status <= 5 ? v[status - 1] : ''
}

/** 量词：动画 / 游戏 用「部」，小说 / 漫画 用「本」（仅用户给定的 本/部 两种） */
export function categoryMeasure(category: Category): string {
  if (category === 'anime' || category === 'galgame') return '部'
  return '本' // light_novel / manga
}

/** 分类中文名：动画 / 轻小说 / 漫画 / 游戏 */
export function categoryName(category: Category): string {
  return (
    { anime: '动画', light_novel: '小说', manga: '漫画', galgame: '游戏' } as Record<
      Category,
      string
    >
  )[category] ?? '作品'
}

/**
 * 已收藏时展示的文字，如：
 *   我想看这部动画 / 我读过这本小说 / 我玩过这个游戏 / 我搁置这本漫画 / 我抛弃这部动画
 */
export function collectionPhrase(category: Category, status: number): string {
  const verb = statusVerb(category, status)
  if (!verb) return ''
  return `我${verb}这${categoryMeasure(category)}${categoryName(category)}`
}
