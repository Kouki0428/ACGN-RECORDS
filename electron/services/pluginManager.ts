import electron from 'electron'
const { app } = electron
import { join, basename } from 'node:path'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { getDb } from './db/connection'
import type { PluginDescriptor, PluginManifest, PluginPermission } from '../../shared/types'

/**
 * 插件管理器：扫描 userData/plugins/<id>/ 下的本地插件。
 * - 权限由用户全权决策（settings 表持久化：插件启停 + 已授权权限集合）；
 * - 运行时按授权集合拦截（权限过滤在 IPC 层 / 本服务完成）。
 * - 主进程只负责读 manifest / css / js 文本并交付渲染端，绝不执行插件脚本。
 */
export const PLUGIN_PERMISSIONS: PluginPermission[] = [
  'style',
  'script',
  'storage',
  'collection',
  'subject',
  'settings',
  'ui'
]

export function pluginDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

// 从 settings 表读取插件启停 + 权限（key: plugin:<id>:enabled / plugin:<id>:perms）
async function readState(id: string): Promise<{ enabled: boolean; permissions: PluginPermission[] }> {
  try {
    const db = await getDb()
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`plugin:${id}:enabled`) as { value: string } | undefined
    const permsRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`plugin:${id}:perms`) as { value: string } | undefined
    let permissions: PluginPermission[] = []
    if (permsRow?.value) {
      try {
        permissions = JSON.parse(permsRow.value) as PluginPermission[]
      } catch {
        permissions = []
      }
    }
    return { enabled: row?.value === '1', permissions }
  } catch {
    return { enabled: false, permissions: [] }
  }
}

async function writeEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`plugin:${id}:enabled`, enabled ? '1' : '0')
}

async function writePermissions(id: string, permissions: PluginPermission[]): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(`plugin:${id}:perms`, JSON.stringify(permissions))
}

// 读取单个插件（含启停/权限/内容）。disabled=true 时不读 css/js 内容
async function loadPlugin(id: string, dir: string, includeContent: boolean): Promise<PluginDescriptor | null> {
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PluginManifest
  } catch {
    return null // manifest 缺失/非法：跳过
  }
  if (!manifest.id || manifest.id !== id) return null
  const state = await readState(id)
  // 首次安装未设权限：默认全部授予（用户全权，之后可随时收紧）；不启用
  let permissions = state.permissions
  if (state.permissions.length === 0) {
    permissions = manifest.permissions ?? PLUGIN_PERMISSIONS.filter((p) => p === 'style' || p === 'script')
  }
  const desc: PluginDescriptor = {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version: manifest.version ?? '0.0.0',
    description: manifest.description,
    author: manifest.author,
    enabled: state.enabled,
    permissions,
    requestedPermissions: manifest.permissions ?? []
  }
  if (includeContent && state.enabled) {
    const styleFile = manifest.entry?.style
    if (styleFile && existsSync(join(dir, styleFile))) {
      try {
        desc.css = readFileSync(join(dir, styleFile), 'utf8')
      } catch {
        desc.css = undefined
      }
    }
    const renderFile = manifest.entry?.render
    if (renderFile && existsSync(join(dir, renderFile))) {
      try {
        desc.script = readFileSync(join(dir, renderFile), 'utf8')
      } catch {
        desc.script = undefined
      }
    }
  }
  return desc
}

/** 扫描插件目录，返回全部插件描述（含内容）；includeContent=false 仅清单（更快） */
export async function scanPlugins(includeContent = true): Promise<PluginDescriptor[]> {
  const dir = pluginDir()
  if (!existsSync(dir)) return []
  const out: PluginDescriptor[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    // 只允许目录名与 manifest.id 一致（避免混乱）
    const d = await loadPlugin(id, join(dir, id), includeContent)
    if (d) out.push(d)
  }
  return out
}

/** 设置插件启停；返回更新后的清单 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginDescriptor[]> {
  await writeEnabled(id, enabled)
  return scanPlugins()
}

/** 设置插件某权限授予/撤销；返回更新后的清单 */
export async function setPluginPermission(
  id: string,
  permission: PluginPermission,
  granted: boolean
): Promise<PluginDescriptor[]> {
  const dir = join(pluginDir(), id)
  if (!existsSync(dir)) return scanPlugins()
  const state = await readState(id)
  let perms = state.permissions
  if (granted) {
    if (!perms.includes(permission)) perms = [...perms, permission]
  } else {
    perms = perms.filter((p) => p !== permission)
  }
  await writePermissions(id, perms)
  return scanPlugins()
}

/** 运行时权限校验：插件已启用且拥有该权限，才放行 */
export async function hasPermission(id: string, permission: PluginPermission): Promise<boolean> {
  const state = await readState(id)
  if (!state.enabled) return false
  return state.permissions.includes(permission)
}

/** 插件目录名（供打开目录使用） */
export function openPluginDirPath(): string {
  return pluginDir()
}