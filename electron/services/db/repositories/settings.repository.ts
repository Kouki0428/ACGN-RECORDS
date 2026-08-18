import { getDb } from '../connection'

/** settings 表的简单键值仓储（主进程使用）。敏感值由调用方经 vault 加密后再传入。 */
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}
