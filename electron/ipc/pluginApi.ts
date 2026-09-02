import { getDb } from '../services/db/connection'
import { getSetting, setSetting } from '../services/db/repositories/settings.repository'
import { getUserStats } from '../services/db/repositories/collections.repository'
import { getCollectionExistingBySubject } from '../services/db/repositories/collections.repository'

/**
 * 插件白名单 API：方法名经过硬编码注册表，未注册的一律拒绝。
 * 每个方法在调用前已由插件 IPC 层按「权限」校验过（见 plugin.ipc.ts methodToPermission）。
 * 返回值约定统一为 { ok: true, data } / { ok: false, error }。
 */
export async function callPluginApi(method: string, args: unknown[], pluginId: string): Promise<unknown> {
  const registry: Record<string, (args: unknown[], pid: string) => Promise<unknown>> = {
    // —— 插件独立存储（key 带插件前缀，互相隔离）——
    async 'storage.get'([key]) {
      if (typeof key !== 'string') return err('invalid-arg')
      const db = await getDb()
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`plugin:${pluginId}:${key}`) as
        | { value: string }
        | undefined
      return ok(row?.value ?? null)
    },
    async 'storage.set'([key, value]) {
      if (typeof key !== 'string' || typeof value !== 'string') return err('invalid-arg')
      const db = await getDb()
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(`plugin:${pluginId}:${key}`, value)
      return ok(true)
    },
    // —— 设置（读取/修改应用设置）——
    async 'settings.get'([key]) {
      if (typeof key !== 'string') return err('invalid-arg')
      return ok(await getSetting(key))
    },
    async 'settings.set'([key, value]) {
      if (typeof key !== 'string' || typeof value !== 'string') return err('invalid-arg')
      await setSetting(key, value)
      return ok(true)
    },
    // —— 收藏数据（只读聚合 + 单作品收藏状态）——
    async 'collection.getAll'() {
      return ok(await getUserStats())
    },
    async 'collection.getExisting'([pid]) {
      if (typeof pid !== 'string') return err('invalid-arg')
      return ok(await getCollectionExistingBySubject(pid))
    }
  }

  const fn = registry[method]
  if (!fn) return err('unknown-method')
  try {
    return await fn(args, pluginId)
  } catch (e) {
    return err(String(e))
  }
}

function ok(data: unknown) {
  return { ok: true as const, data }
}
function err(error: string) {
  return { ok: false as const, error }
}