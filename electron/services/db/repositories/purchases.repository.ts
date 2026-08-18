import { getDb } from '../connection'

export interface PurchaseRecord {
  id?: number
  collection_id: number
  platform: string | null
  price: number | null
  currency: string
  purchased_at?: number | null
  note?: string | null
}

/** 取某收藏的购买记录（一个收藏只保留一条购买信息） */
export async function getPurchase(collectionId: number): Promise<PurchaseRecord | undefined> {
  const db = await getDb()
  return db.prepare('SELECT * FROM purchases WHERE collection_id = ?').get(collectionId) as
    | PurchaseRecord
    | undefined
}

/**
 * 写入/更新购买信息：UPSERT，按 collection_id 唯一。
 * 价格等仅保存在本地 SQLite，不会在用户主动同步外上传。
 */
export async function savePurchase(
  collectionId: number,
  data: { platform?: string; price?: number; currency?: string; note?: string }
): Promise<PurchaseRecord> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO purchases (collection_id, platform, price, currency, note, purchased_at)
     VALUES (@collection_id, @platform, @price, @currency, @note, strftime('%s','now'))
     ON CONFLICT(collection_id) DO UPDATE SET
       platform = @platform, price = @price, currency = @currency, note = @note`
  ).run({
    collection_id: collectionId,
    platform: data.platform ?? null,
    price: data.price ?? null,
    currency: data.currency ?? 'CNY',
    note: data.note ?? null
  })
  return (await getPurchase(collectionId))!
}
