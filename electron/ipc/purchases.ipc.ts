import electron from 'electron'
const { ipcMain } = electron
import { getDb } from '../services/db/connection'
import { getPurchase, savePurchase } from '../services/db/repositories/purchases.repository'
import { convertToCNY } from '../services/currency'
import type { Category } from '../../shared/types'

/** 购买信息 IPC：仅本地存储，不随进度上传（除非用户主动同步时另有约定） */
export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:get', async (_event, collectionId: number) => {
    return (await getPurchase(collectionId)) ?? null
  })

  ipcMain.handle(
    'purchases:save',
    async (
      _event,
      collectionId: number,
      data: { platform?: string; price?: number; currency?: string; note?: string }
    ) => {
      return await savePurchase(collectionId, data)
    }
  )

  // 某分类下累计花费（仅统计有价格的购买记录），统一折算为人民币
  ipcMain.handle('purchases:totalSpent', async (_event, category: Category) => {
    const db = await getDb()
    const rows = db
      .prepare(
        `SELECT p.currency AS currency, COALESCE(SUM(p.price), 0) AS total
         FROM purchases p
         JOIN collections c ON c.id = p.collection_id
         JOIN subjects s ON s.id = c.subject_id
         WHERE s.category = ? AND p.price IS NOT NULL
         GROUP BY p.currency`
      )
      .all(category) as { currency: string | null; total: number }[]
    return rows.reduce((sum, r) => sum + convertToCNY(r.total, r.currency), 0)
  })
}
