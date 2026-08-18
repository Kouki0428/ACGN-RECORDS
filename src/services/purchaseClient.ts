import type { Purchase, Category } from '@shared/types'

/** 渲染进程对购买信息主进程能力的封装（Galgame / 单机游戏 模块使用） */
export const purchaseClient = {
  get: (collectionId: number) => window.acgn.purchases.get(collectionId) as Promise<Purchase | null>,
  save: (
    collectionId: number,
    data: { platform?: string; price?: number; currency?: string; note?: string }
  ) => window.acgn.purchases.save(collectionId, data) as Promise<Purchase>,
  totalSpent: (category: Category) => window.acgn.purchases.totalSpent(category) as Promise<number>
}
