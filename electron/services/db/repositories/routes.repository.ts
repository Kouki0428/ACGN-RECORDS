import { getDb } from '../connection'

/** 单条通关路线（Galgame）：路线名依附于本地收藏 */
export interface RouteItem {
  id: number
  name: string
}

/** 取某收藏的通关路线列表（按添加顺序） */
export async function getRoutes(collectionId: number): Promise<RouteItem[]> {
  const db = await getDb()
  const rows = db
    .prepare('SELECT id, name FROM routes WHERE collection_id = ? ORDER BY position ASC, id ASC')
    .all(collectionId) as { id: number; name: string }[]
  return rows
}

/** 新增一条路线，返回新行 id */
export async function addRoute(collectionId: number, name: string): Promise<number> {
  const db = await getDb()
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM routes WHERE collection_id = ?')
    .get(collectionId) as { m: number }
  const res = db
    .prepare(
      `INSERT INTO routes (collection_id, name, position, created_at)
       VALUES (?, ?, ?, strftime('%s','now'))`
    )
    .run(collectionId, name ?? '', max.m + 1)
  return Number(res.lastInsertRowid)
}

/** 修改路线名称 */
export async function updateRoute(id: number, name: string): Promise<void> {
  const db = await getDb()
  db.prepare('UPDATE routes SET name = ? WHERE id = ?').run(name ?? '', id)
}

/** 删除一条路线 */
export async function deleteRoute(id: number): Promise<void> {
  const db = await getDb()
  db.prepare('DELETE FROM routes WHERE id = ?').run(id)
}
