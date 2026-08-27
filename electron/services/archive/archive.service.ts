// Bangumi 离线数据库（Archive）服务：下载每周导出 dump、sha256 校验、解压 JSONL、入库到独立 SQLite。
// 数据来源：https://github.com/bangumi/Archive （latest.json 指向最新 dump 的下载地址与 sha256）
// 该库与用户个人收藏库（bangumi-for-pc.db）完全分离，仅作离线只读数据源：
//   - 支持离线搜索全 Bangumi 条目
//   - 详情页角色 / 关联作品 / 声优 在实时 API 不可用时回退到此库（无需登录即可看）
import electron from 'electron'
import { join } from 'node:path'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
const { app } = electron
import { appendFileSync } from 'node:fs'

// 评分诊断追踪：把 resolveScore / getArchiveScore / getArchiveDb 的真实运行时结果
// 写入 userData/score-trace.log（console.warn 仅进终端，GUI 启动看不到；此文件可直接被读取定位）。
export function traceScore(tag: string, msg: string): void {
  try {
    const p = join(app.getPath('userData'), 'score-trace.log')
    appendFileSync(p, `[${new Date().toISOString()}] [${tag}] ${msg}\n`)
  } catch {
    /* 追踪失败不影响主流程 */
  }
}

import {
  relationLabel,
  characterRelationLabel,
  categoryToBgmType
} from './constants'
import { getSubjectCover, classifyBookCategory } from '../api/bangumi'

// Bangumi 书籍 platform code → 字符串（与 classifyBookCategory 期望的 '小说'/'漫画' 一致）。
// 离线 Archive 的 platform 存的是数字 code：1001=漫画，1002=轻小说；其余（1003 文库 /
// 1004 单行本 / 1005 杂志 / 1006 同人志 / 0 未知）构成复杂、且混杂画集/写真/指南，
// 不作强映射，交给 classifyBookCategory 按 tag 计数兜底最稳妥。
const BOOK_PLATFORM_CATEGORY: Record<number, '小说' | '漫画'> = {
  1001: '漫画',
  1002: '小说'
}
import { getSetting } from '../db/repositories/settings.repository'
import { getDb } from '../db/connection'
import type {
  ArchiveMeta,
  ArchiveProgress,
  ArchiveUpdateResult,
  ArchiveSubjectSearch,
  ArchiveTagSubject,
  SubjectCharacter,
  SubjectRelation
} from '../../../shared/types'

const LATEST_JSON =
  'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json'
// 仅这 9 个 JSONL 文件会被解析入库
const DUMP_FILES = [
  'subject.jsonlines',
  'character.jsonlines',
  'person.jsonlines',
  'episode.jsonlines',
  'subject-characters.jsonlines',
  'subject-relations.jsonlines',
  'subject-persons.jsonlines',
  'person-characters.jsonlines',
  'person-relations.jsonlines'
]

function getArchiveDir(): string {
  const dir = join(app.getPath('userData'), 'bangumi-archive')
  mkdirSync(dir, { recursive: true })
  return dir
}
function getExtractDir(): string {
  return join(getArchiveDir(), 'extract')
}
function getDumpPath(): string {
  return join(getArchiveDir(), 'dump.zip')
}

// ---------- 独立 SQLite 连接（懒加载，与用户库隔离） ----------
let archiveDbPromise: Promise<any> | null = null
async function getArchiveDb(): Promise<any> {
  if (!archiveDbPromise) {
    archiveDbPromise = (async () => {
      const Database = (await import('better-sqlite3')).default
      const dbPath = join(getArchiveDir(), 'bangumi-archive.db')
      let db: any
      let readonly = false
      try {
        db = new Database(dbPath)
      } catch (openErr) {
        traceScore('getArchiveDb', 'OPEN_FAIL mode=rw err=' + String(openErr))
        // 主库文件通常完好；上次进程被强杀可能遗留损坏的 -wal/-shm（校验失败），
        // 导致整库打不开 → 评分/角色兜底全 null。WAL 仅含未 checkpoint 的增量
        // （score/rank 缓存，可经 API 重拉），丢弃后可从主库文件正常打开，
        // 避免「离线库明明存在却读不了 → 评分全显示『暂无评分』」。
        const wal = dbPath + '-wal'
        const shm = dbPath + '-shm'
        if (existsSync(wal) || existsSync(shm)) {
          try {
            if (existsSync(wal)) rmSync(wal)
            if (existsSync(shm)) rmSync(shm)
          } catch {
            /* 清理失败则继续尝试只读打开 */
          }
        }
        try {
          db = new Database(dbPath)
        } catch (rwErr) {
          // 读写打开彻底失败（权限/锁定/损坏）：降级为只读打开，评分读取足够，且能绕过 WAL 写锁
          traceScore('getArchiveDb', 'OPEN_FAIL mode=rw(afterClean) err=' + String(rwErr) + ' -> try readonly')
          db = new Database(dbPath, { readonly: true, fileMustExist: true })
          readonly = true
          traceScore('getArchiveDb', 'OPEN_OK mode=ro')
        }
      }
      // 只读连接不执行写操作（CREATE TABLE / 改 journal_mode 都会失败）
      if (!readonly) {
        db.pragma('journal_mode = WAL')
        db.pragma('synchronous = NORMAL')
        ensureArchiveTables(db)
      }
      traceScore('getArchiveDb', 'OPEN_OK mode=' + (readonly ? 'ro' : 'rw') + ' path=' + dbPath)
      return db
    })().catch((e) => {
      traceScore('getArchiveDb', 'FATAL err=' + String(e))
      archiveDbPromise = null
      throw e
    })
  }
  return archiveDbPromise
}

/**
 * 预热离线库连接：在 app 启动时调用一次（离线库文件存在时），把 400MB 库的冷打开成本
 * 前置到启动阶段，避免首次打开作品详情时因懒加载打开 Archive 库而卡顿 0.5~1s。
 * 离线库文件不存在时静默跳过（绝不创建空库，也不抛错）。
 */
export function warmArchiveDb(): void {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return
  // fire-and-forget：仅触发连接建立与 ensureArchiveTables，失败忽略（首次详情打开时仍会重试）
  void getArchiveDb().catch((e) => {
    console.warn('[warmArchiveDb] 预热失败（忽略，首次详情打开时会重试）：', e)
  })
}

function tableExists(db: any, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

/** 离线库 schema 版本；每次变更入库字段（如新增 image_url / score_details）时 +1，触发旧库强制重新入库。 */
export const ARCHIVE_SCHEMA_VERSION = 3

/** 从 Bangumi images 对象里挑一个可用 URL（中等尺寸优先，适合头像/封面）。 */
function firstImageUrl(images: any): string | null {
  if (!images || typeof images !== 'object') return null
  const u = images.medium ?? images.large ?? images.common ?? images.small ?? images.grid
  return typeof u === 'string' && u ? u : null
}

/**
 * 从 Archive 导出的「原始 wiki 字符串」infobox 里提取简体中文名。
 * 角色/人物的中文名不在顶层 name_cn（Archive 的 character/person JSONL 根本没有该字段），
 * 而是藏在 infobox 的 wiki 语法 `|简体中文名=xxx` 里。用轻量正则即可提取，无需完整 wiki 解析器。
 * 这与在线详情接口（v0 /characters/{id}）的 JSON infobox 互补：离线兜底时走这里，在线时走 API。
 */
function extractCnFromWikiInfobox(raw: any): string | undefined {
  if (typeof raw !== 'string' || !raw.includes('简体中文名')) return undefined
  const m = raw.match(/简体中文名\s*=\s*([^\n\r|{}]+)/)
  if (m && m[1]) {
    const v = m[1].trim()
    return v || undefined
  }
  return undefined
}

/**
 * 把 Bangumi 离线库（Archive）的原始 wiki 字符串 infobox 解析成 {key, value}[]，
 * 与 v0 详情接口 parseSubjectMeta 输出的 SubjectMeta[] 形状一致，供制作信息卡片直接渲染。
 * 离线库 infobox 与角色/人物的 infobox 同格式（如 `{{Infobox animanga|制作公司=...|导演=...}}`），
 * 用「先去掉最外层 {{}}、再在顶层（不拆开 [[]]/{{}} 内部）按 | 切分、按首个 = 拆 key/value」即可；
 * 值里的 [[]] 链接、{{lang}} 模板、<ref> 由 cleanWikiValue 清洗。
 */
export function parseWikiInfobox(raw: any): SubjectMeta[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const segs = splitWikiTopLevel(raw)
  const meta: SubjectMeta[] = []
  for (const seg of segs) {
    const eq = seg.indexOf('=')
    if (eq <= 0) continue // 首个片段是模板名（无 =），跳过
    const key = seg.slice(0, eq).trim()
    const value = cleanWikiValue(seg.slice(eq + 1))
    if (!key || !value) continue
    meta.push({ key, value })
  }
  return meta
}

/** 先去掉最外层 {{}} 包裹，再在顶层（不拆开 [[]]/{{}} 内部）按 | 切分 */
function splitWikiTopLevel(s: string): string[] {
  let body = s
  const open = s.indexOf('{{')
  const close = s.lastIndexOf('}}')
  if (open !== -1 && close > open) {
    body = s.substring(open + 2, close)
  }
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    const next = body[i + 1]
    if (c === '[' && next === '[') {
      depth++
      buf += '[['
      i++
      continue
    }
    if (c === ']' && next === ']') {
      depth = Math.max(0, depth - 1)
      buf += ']]'
      i++
      continue
    }
    if (c === '{' && next === '{') {
      depth++
      buf += '{{'
      i++
      continue
    }
    if (c === '}' && next === '}') {
      depth = Math.max(0, depth - 1)
      buf += '}}'
      i++
      continue
    }
    if (c === '|' && depth === 0) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += c
  }
  if (buf) out.push(buf)
  return out
}

/** 清洗 wiki 值：去 <ref>、解 [[]] 链接、解 {{lang}}、去残留标记与多余空白 */
function cleanWikiValue(v: string): string {
  let s = v || ''
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '')
  s = s.replace(/\[\[([^\]|]+)\|([^\]|]+)\]\]/g, '$2').replace(/\[\[([^\]|]+)\]\]/g, '$1')
  s = s.replace(/\{\{lang\|[^|]*\|([^}]*)\}\}/g, '$1')
  s = s.replace(/\{\{[^}]*\}\}/g, '')
  s = s.replace(/''+/g, '')
  s = s.replace(/[[\]{}]/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * 从离线库 arc_subjects 取标签 / 制作信息 / 评分，供「未登录也能填充制作信息」使用。
 * - tags：dump 的 JSON 数组（{name,count} / 字符串），与 parseSubjectMeta 期望格式一致，直接可用；
 * - infobox：原始 wiki 字符串，经 parseWikiInfobox 转成 SubjectMeta[]；
 * - score：站点均分（10 分制），直接作 rating。
 * 返回 null 表示离线库无此作品（或未初始化），调用方应回退到联网补全。
 */
export async function getArchiveSubjectMeta(
  bangumiId: number
): Promise<{ tags: SubjectTag[]; meta: SubjectMeta[]; rating: number | null; metaTags: string[] } | null> {
  try {
    const db = await getArchiveDb()
    if (!tableExists(db, 'arc_subjects')) return null
    const row = db
      .prepare('SELECT tags, infobox, score, meta_tags FROM arc_subjects WHERE id = ?')
      .get(Number(bangumiId)) as any
    if (!row) return null
    const tags: SubjectTag[] = []
    try {
      const arr = JSON.parse(row.tags || '[]')
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (!t) continue
          const name = typeof t === 'string' ? t : (t.name ?? t._name ?? '')
          if (!name) continue
          tags.push({ name: String(name), count: Number(t.count) || 0 })
        }
      }
    } catch {
      /* ignore */
    }
    const meta = parseWikiInfobox(row.infobox)
    const rating = typeof row.score === 'number' && isFinite(row.score) ? row.score : null
    let metaTags: string[] = []
    try {
      const mt = JSON.parse(row.meta_tags || '[]')
      if (Array.isArray(mt)) metaTags = mt.map(String).filter(Boolean)
    } catch {
      /* ignore */
    }
    return { tags, meta, rating, metaTags }
  } catch (e) {
    console.warn('[archive] getArchiveSubjectMeta 失败（忽略）：', e)
    return null
  }
}

function addColumnIfMissing(db: any, table: string, column: string, type: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (!info.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

function ensureArchiveTables(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arc_subjects (
      id INTEGER PRIMARY KEY, type INTEGER, name TEXT, name_cn TEXT, infobox TEXT,
      platform INTEGER, summary TEXT, nsfw INTEGER, tags TEXT, meta_tags TEXT, score REAL, rank INTEGER, date TEXT,
      image_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arc_subjects_name ON arc_subjects(name);
    CREATE INDEX IF NOT EXISTS idx_arc_subjects_namecn ON arc_subjects(name_cn);

    CREATE TABLE IF NOT EXISTS arc_characters (
      id INTEGER PRIMARY KEY, role INTEGER, name TEXT, infobox TEXT, summary TEXT, comments INTEGER, collects INTEGER,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS arc_persons (
      id INTEGER PRIMARY KEY, name TEXT, type INTEGER, career TEXT, infobox TEXT, summary TEXT, comments INTEGER, collects INTEGER
    );

    CREATE TABLE IF NOT EXISTS arc_episodes (
      id INTEGER PRIMARY KEY, name TEXT, name_cn TEXT, description TEXT, airdate TEXT,
      disc INTEGER, duration TEXT, subject_id INTEGER, sort INTEGER, type INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_arc_episodes_subject ON arc_episodes(subject_id);

    CREATE TABLE IF NOT EXISTS arc_subject_characters (
      subject_id INTEGER, character_id INTEGER, type INTEGER, ord INTEGER,
      PRIMARY KEY (subject_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asc_subject ON arc_subject_characters(subject_id);

    CREATE TABLE IF NOT EXISTS arc_subject_relations (
      subject_id INTEGER, relation_type INTEGER, related_subject_id INTEGER, ord INTEGER,
      PRIMARY KEY (subject_id, related_subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asr_subject ON arc_subject_relations(subject_id);

    CREATE TABLE IF NOT EXISTS arc_subject_persons (
      subject_id INTEGER, person_id INTEGER, position INTEGER, appear_eps TEXT,
      PRIMARY KEY (subject_id, person_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asp_subject ON arc_subject_persons(subject_id);

    CREATE TABLE IF NOT EXISTS arc_person_characters (
      person_id INTEGER, subject_id INTEGER, character_id INTEGER, summary TEXT,
      PRIMARY KEY (person_id, subject_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_apc_subject_char ON arc_person_characters(subject_id, character_id);

    CREATE TABLE IF NOT EXISTS arc_person_relations (
      person_type TEXT, person_id INTEGER, related_person_id INTEGER, relation_type INTEGER, spoiler INTEGER, ended INTEGER
    );

    CREATE TABLE IF NOT EXISTS archive_meta (
      key TEXT PRIMARY KEY, value TEXT
    );
  `)
  // 兼容已存在的旧库：仅当列不存在时才补加 image_url（ALTER TABLE ADD COLUMN 在列已存在时会抛错，
  // 导致 ensureArchiveTables 整体失败、getArchiveDb 拒绝、离线库兜底完全失效——这正是「角色/关联作品
  // 列表从有变无」的根因）。
  addColumnIfMissing(db, 'arc_subjects', 'image_url', 'TEXT')
  addColumnIfMissing(db, 'arc_characters', 'image_url', 'TEXT')
  // 评分分布（1–10 星票数）直接来自 Bangumi Archive dump 的 score_details 字段
  // （自 2023-07-27 起导出，结构为 { count: {"1".."10": 票数} 或 [10 整数], total, score, rank }）。
  // 入库时由 subject 的 mapRow 原样存入本列（JSON 文本），离线即可直接渲染分布柱状图，无需联网。
  // addColumnIfMissing 保证已下载的旧库（无此列）打开时不报错、不触发整库重下。
  addColumnIfMissing(db, 'arc_subjects', 'score_details', 'TEXT')
  // 角色/人物中文译名字段占位列。注意：Archive 的 character/person JSONL **没有顶层 name_cn**
  // （已核实官方数据格式——中文名藏在 infobox 原始 wiki 字符串 `|简体中文名=xxx` 里）。
  // 故该列实际恒为空、不被依赖；离线中文名由 getArchiveExtra 实时用 extractCnFromWikiInfobox
  // 解析 arc_characters.infobox 列得到。幂等加列只为兼容未来若改为「入库即解析填充」。
  addColumnIfMissing(db, 'arc_characters', 'name_cn', 'TEXT')
  addColumnIfMissing(db, 'arc_persons', 'name_cn', 'TEXT')
}

// ---------- 评分分布（直接来自 dump 的 score_details 列，离线即可读） ----------
/**
 * 解析 Bangumi 评分分布对象（score_details / rating）。兼容两种形态：
 *   - 形态 A（Archive dump 原始导出）：score_details 本身就是各星票数 map
 *     {"1":n, ..., "10":n}（可能附带 total 键，也可能没有；无 total 时按各星求和）。
 *   - 形态 B（本应用联网更新后回写）：{ count: {...} | [...], total }。
 * total 缺失时用各星票数求和。返回长度 10 的 ratingCount（索引 i 对应 (i+1) 星）与总票数。
 */
function parseScoreDetails(sd: any): { ratingCount: number[]; ratingTotal: number } | null {
  if (!sd || typeof sd !== 'object') return null
  // 形态 A：直接是 {"1":n,...,"10":n}（含可能的 total 键）
  const looksLikeDirectMap = sd['1'] !== undefined || sd[1] !== undefined
  const c = looksLikeDirectMap ? sd : sd.count
  if (!c || typeof c !== 'object') return null
  const arr: number[] = new Array(10).fill(0)
  if (Array.isArray(c) && c.length >= 10) {
    // 形态：[n1, n2, ..., n10]，索引 i 对应 (i+1) 星
    for (let i = 0; i < 10; i++) arr[i] = Number(c[i]) || 0
  } else {
    // 形态：{"1": n1, ..., "10": n10}
    for (let star = 1; star <= 10; star++) {
      const v = c[String(star)] ?? c[star]
      arr[star - 1] = Number(v) || 0
    }
  }
  const total = typeof sd.total === 'number' ? sd.total : arr.reduce((a, b) => a + b, 0)
  return { ratingCount: arr, ratingTotal: total }
}

/**
 * 从离线库读取某 Bangumi 作品的评分分布（1–10 星票数）。
 * 数据直接来自入库时保存的 score_details 列（dump 自带，无需联网）。
 * 离线库文件不存在 / 该行无分布数据时返回 null（不创建空库，不抛错）。
 */
export async function getArchiveRatingDistribution(
  bangumiId: number | string
): Promise<{ ratingCount: number[]; ratingTotal: number } | null> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return null
  try {
    const db = await getArchiveDb()
    const row = db
      .prepare('SELECT score_details FROM arc_subjects WHERE id = ?')
      .get(Number(bangumiId))
    if (!row || !row.score_details) return null
    return parseScoreDetails(JSON.parse(row.score_details))
  } catch (e) {
    console.warn('[getArchiveRatingDistribution] 读离线库失败（忽略）：', e)
    return null
  }
}

/**
 * 把某 Bangumi 作品的评分分布写回离线库（仅 UPDATE 已入库的行，绝不 INSERT 假行）。
 * 直接写入 score_details 列（规范化的 { count, total } 对象），与 dump 入库同源。
 * 离线库文件不存在时静默跳过（不创建空库）。
 */
export async function saveArchiveRatingDistribution(
  bangumiId: number | string,
  ratingCount: number[],
  ratingTotal: number
): Promise<void> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return
  try {
    const db = await getArchiveDb()
    db.prepare(
      'UPDATE arc_subjects SET score_details = ? WHERE id = ?'
    ).run(JSON.stringify({ count: ratingCount, total: ratingTotal }), Number(bangumiId))
  } catch (e) {
    console.warn('[saveArchiveRatingDistribution] 写离线库失败（忽略）：', e)
  }
}

/**
 * 从离线库读取某 Bangumi 作品的站点排名（rank，数字）。
 * 离线库文件不存在 / 该行无 rank 时返回 null（不创建空库，不抛错）。
 * 注：Archive dump 的 rank 仅对进入榜单的热门作品有值，冷门作品多为空。
 */
export async function getArchiveRank(
  bangumiId: number | string
): Promise<number | null> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return null
  try {
    const db = await getArchiveDb()
    const row = db.prepare('SELECT rank FROM arc_subjects WHERE id = ?').get(Number(bangumiId))
    if (!row || row.rank == null) return null
    const n = typeof row.rank === 'number' ? row.rank : Number(row.rank)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch (e) {
    console.warn('[getArchiveRank] 读离线库失败（忽略）：', e)
    return null
  }
}

/**
 * 把某 Bangumi 作品的站点排名写回离线库（仅 UPDATE 已入库的行，绝不 INSERT 假行）。
 * 离线库文件不存在时静默跳过（不创建空库）。
 */
export async function saveArchiveRank(
  bangumiId: number | string,
  rank: number
): Promise<void> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return
  try {
    const db = await getArchiveDb()
    db.prepare('UPDATE arc_subjects SET rank = ? WHERE id = ?').run(Number(rank), Number(bangumiId))
  } catch (e) {
    console.warn('[saveArchiveRank] 写离线库失败（忽略）：', e)
  }
}

/**
 * 从离线库读取某 Bangumi 作品的站点均分（score，数字，10 分制 1 位小数）。
 * 数据直接来自入库时保存的 score 列（dump 自带，无需联网），全量作品均有值。
 * 离线库文件不存在 / 该行无 score 时返回 null（不创建空库，不抛错）。
 */
export async function getArchiveScore(
  bangumiId: number | string
): Promise<number | null> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) {
    traceScore('getArchiveScore', 'FILE_MISSING pid=' + bangumiId + ' dir=' + p)
    console.warn('[getArchiveScore] FILE MISSING pid=' + bangumiId + ' dir=' + p)
    return null
  }
  try {
    traceScore('getArchiveScore', 'ENTER pid=' + bangumiId)
    const db = await getArchiveDb()
    const row = db.prepare('SELECT score FROM arc_subjects WHERE id = ?').get(Number(bangumiId))
    if (!row || row.score == null) {
      // 诊断：库存在但此行无 score（正常不应发生，因 Archive 全量含 score）。
      // 若出现，说明 pid 与 Archive 的 id 体系不一致，或库文件异常。
      traceScore('getArchiveScore', 'NO_ROW_OR_NULL pid=' + bangumiId)
      console.warn(`[getArchiveScore] 离线库无此作品评分 pid=${bangumiId} db=${p}`)
      return null
    }
    const n = typeof row.score === 'number' ? row.score : Number(row.score)
    const res = Number.isFinite(n) ? n : null
    traceScore('getArchiveScore', 'OK pid=' + bangumiId + ' score=' + res)
    return res
  } catch (e) {
    traceScore('getArchiveScore', 'ERROR pid=' + bangumiId + ' err=' + String(e))
    console.warn('[getArchiveScore] 读离线库失败（忽略）：', e)
    return null
  }
}

/**
 * 把某 Bangumi 作品的站点均分写回离线库（仅 UPDATE 已入库的行，绝不 INSERT 假行）。
 * 离线库文件不存在时静默跳过（不创建空库）。
 */
export async function saveArchiveScore(
  bangumiId: number | string,
  score: number
): Promise<void> {
  const p = join(getArchiveDir(), 'bangumi-archive.db')
  if (!existsSync(p)) return
  try {
    const db = await getArchiveDb()
    db.prepare('UPDATE arc_subjects SET score = ? WHERE id = ?').run(Number(score), Number(bangumiId))
  } catch (e) {
    console.warn('[saveArchiveScore] 写离线库失败（忽略）：', e)
  }
}

// ---------- meta ----------
export async function getArchiveMeta(): Promise<ArchiveMeta | null> {
  // 离线库尚未初始化（文件不存在）时直接返回 null，避免凭空创建空库
  if (!existsSync(join(getArchiveDir(), 'bangumi-archive.db'))) return null
  try {
    const db = await getArchiveDb()
    if (!tableExists(db, 'archive_meta')) return null
    const rows = db.prepare('SELECT key, value FROM archive_meta').all() as any[]
    if (!rows.length) return null
    const m: Record<string, string> = {}
    for (const r of rows) m[r.key] = r.value
    return {
      version: m.version ?? null,
      sha256: m.sha256 ?? null,
      size: m.size ? Number(m.size) : null,
      date: m.date ?? null,
      lastSuccessAt: m.lastSuccessAt ? Number(m.lastSuccessAt) : null,
      lastError: m.lastError ?? null,
      status: m.status ?? null,
      schemaVersion: m.schemaVersion ? Number(m.schemaVersion) : null
    }
  } catch {
    return null
  }
}

async function setArchiveMeta(partial: Record<string, unknown>): Promise<void> {
  const db = await getArchiveDb()
  const entries = Object.entries(partial).map(([k, v]) => [k, v == null ? null : String(v)])
  const ups = db.prepare('INSERT OR REPLACE INTO archive_meta (key, value) VALUES (?, ?)')
  const tx = db.transaction((es: any[][]) => {
    for (const [k, v] of es) ups.run(k, v)
  })
  tx(entries)
}

// ---------- latest.json ----------
async function getLatestDumpInfo(): Promise<{
  name: string
  url: string
  sha256: string
  size: number
  date: string | null
}> {
  const res = await fetch(LATEST_JSON)
  if (!res.ok) throw new Error(`获取 latest.json 失败：${res.status}`)
  const json = (await res.json()) as any
  const name: string = json.name || ''
  const dateMatch = name.match(/dump-(\d{4}-\d{2}-\d{2})/)
  // Bangumi Archive 的 digest 形如 "sha256:xxxx"，需去掉前缀再与本地计算的裸 hex 比较
  const sha256 = (json.digest || '').replace(/^sha256:/i, '').trim().toLowerCase()
  return {
    name,
    url: json.browser_download_url,
    sha256,
    size: Number(json.size || 0),
    date: dateMatch ? dateMatch[1] : null
  }
}

// ---------- 下载（流式 + sha256 校验） ----------
async function downloadDump(
  url: string,
  dest: string,
  expectedSha: string,
  onProgress?: (p: ArchiveProgress) => void
): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  const file = createWriteStream(dest)
  const hash = createHash('sha256')
  let downloaded = 0
  const reader = res.body!.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      downloaded += value.length
      hash.update(value)
      file.write(value)
      onProgress?.({ stage: 'download', downloaded, total })
    }
  }
  await new Promise<void>((resolve, reject) => file.end((e) => (e ? reject(e) : resolve())))
  const actual = hash.digest('hex')
  if (expectedSha && actual !== expectedSha) {
    throw new Error(`sha256 校验失败（期望 ${expectedSha}，实际 ${actual}）`)
  }
  return actual
}

/** 计算磁盘上已有文件的 sha256（用于判断已下载的 dump.zip 是否与最新一致，避免重复下载 409MB）。 */
async function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (c: Buffer) => hash.update(c))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// ---------- 解压 ----------
async function extractDump(zipPath: string, extractDir: string): Promise<void> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipPath)
  mkdirSync(extractDir, { recursive: true })
  zip.extractAllTo(extractDir, true)
}

// ---------- 入库 ----------
interface FileSpec {
  file: string
  table: string
  columns: string[]
  mapRow: (r: any) => any[]
  label: string
}

const FILE_SPECS: FileSpec[] = [
  {
    file: 'subject.jsonlines',
    table: 'arc_subjects',
    columns: ['id', 'type', 'name', 'name_cn', 'infobox', 'platform', 'summary', 'nsfw', 'tags', 'meta_tags', 'score', 'rank', 'date', 'image_url', 'score_details'],
    label: '条目',
    mapRow: (r) => [
      r.id ?? null,
      r.type ?? null,
      r.name ?? '',
      r.name_cn ?? '',
      r.infobox ?? '',
      r.platform ?? null,
      r.summary ?? '',
      r.nsfw ? 1 : 0,
      JSON.stringify(r.tags ?? []),
      JSON.stringify(r.meta_tags ?? []),
      typeof r.score === 'number' ? r.score : null,
      typeof r.rank === 'number' ? r.rank : null,
      r.date ?? null,
      firstImageUrl(r.images),
      JSON.stringify(r.score_details ?? null)
    ]
  },
  {
    file: 'character.jsonlines',
    table: 'arc_characters',
    columns: ['id', 'role', 'name', 'name_cn', 'infobox', 'summary', 'comments', 'collects', 'image_url'],
    label: '角色',
    mapRow: (r) => [r.id ?? null, r.role ?? null, r.name ?? '', r.name_cn ?? '', r.infobox ?? '', r.summary ?? '', r.comments ?? 0, r.collects ?? 0, firstImageUrl(r.images)]
  },
  {
    file: 'person.jsonlines',
    table: 'arc_persons',
    columns: ['id', 'name', 'name_cn', 'type', 'career', 'infobox', 'summary', 'comments', 'collects'],
    label: '人物',
    mapRow: (r) => [
      r.id ?? null,
      r.name ?? '',
      r.name_cn ?? '',
      r.type ?? null,
      JSON.stringify(r.career ?? []),
      r.infobox ?? '',
      r.summary ?? '',
      r.comments ?? 0,
      r.collects ?? 0
    ]
  },
  {
    file: 'episode.jsonlines',
    table: 'arc_episodes',
    columns: ['id', 'name', 'name_cn', 'description', 'airdate', 'disc', 'duration', 'subject_id', 'sort', 'type'],
    label: '章节',
    mapRow: (r) => [
      r.id ?? null,
      r.name ?? '',
      r.name_cn ?? '',
      r.description ?? '',
      r.airdate ?? '',
      r.disc ?? null,
      r.duration ?? '',
      r.subject_id ?? null,
      r.sort ?? null,
      r.type ?? null
    ]
  },
  {
    file: 'subject-characters.jsonlines',
    table: 'arc_subject_characters',
    columns: ['subject_id', 'character_id', 'type', 'ord'],
    label: '条目-角色',
    mapRow: (r) => [r.subject_id ?? null, r.character_id ?? null, r.type ?? null, r.order ?? null]
  },
  {
    file: 'subject-relations.jsonlines',
    table: 'arc_subject_relations',
    columns: ['subject_id', 'relation_type', 'related_subject_id', 'ord'],
    label: '条目-关联',
    mapRow: (r) => [r.subject_id ?? null, r.relation_type ?? null, r.related_subject_id ?? null, r.order ?? null]
  },
  {
    file: 'subject-persons.jsonlines',
    table: 'arc_subject_persons',
    columns: ['subject_id', 'person_id', 'position', 'appear_eps'],
    label: '条目-人物',
    mapRow: (r) => [r.subject_id ?? null, r.person_id ?? null, r.position ?? null, r.appear_eps ?? '']
  },
  {
    file: 'person-characters.jsonlines',
    table: 'arc_person_characters',
    columns: ['person_id', 'subject_id', 'character_id', 'summary'],
    label: '人物-角色',
    mapRow: (r) => [r.person_id ?? null, r.subject_id ?? null, r.character_id ?? null, r.summary ?? '']
  },
  {
    file: 'person-relations.jsonlines',
    table: 'arc_person_relations',
    columns: ['person_type', 'person_id', 'related_person_id', 'relation_type', 'spoiler', 'ended'],
    label: '人物-关联',
    mapRow: (r) => [
      r.person_type ?? '',
      r.person_id ?? null,
      r.related_person_id ?? null,
      r.relation_type ?? null,
      r.spoiler ? 1 : 0,
      r.ended ? 1 : 0
    ]
  }
]

async function ingestDump(extractDir: string, onProgress?: (p: ArchiveProgress) => void): Promise<void> {
  const db = await getArchiveDb()
  const CHUNK = 20000
  for (const spec of FILE_SPECS) {
    const filePath = join(extractDir, spec.file)
    if (!existsSync(filePath)) {
      console.warn('[archive] 跳过缺失文件', spec.file)
      continue
    }
    // 清空旧数据后重新写入
    db.prepare(`DELETE FROM ${spec.table}`).run()
    const insert = db.prepare(
      `INSERT OR REPLACE INTO ${spec.table} (${spec.columns.join(',')}) VALUES (${spec.columns.map(() => '?').join(',')})`
    )
    let count = 0
    let chunk: any[][] = []
    db.exec('BEGIN')
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      let row: any
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      chunk.push(spec.mapRow(row))
      if (chunk.length >= CHUNK) {
        const tx = db.transaction((rows: any[][]) => {
          for (const v of rows) insert.run(...v)
        })
        tx(chunk)
        count += chunk.length
        chunk = []
        onProgress?.({ stage: 'ingest', table: spec.label, count })
      }
    }
    if (chunk.length) {
      const tx = db.transaction((rows: any[][]) => {
        for (const v of rows) insert.run(...v)
      })
      tx(chunk)
      count += chunk.length
    }
    db.exec('COMMIT')
    onProgress?.({ stage: 'ingest', table: spec.label, count, done: true })
  }
}

// ---------- 对外：更新 ----------
let isUpdating = false
export async function updateArchive(onProgress?: (p: ArchiveProgress) => void): Promise<ArchiveUpdateResult> {
  if (isUpdating) return { status: 'error', error: '已有更新任务在进行中' }
  isUpdating = true
  try {
    onProgress?.({ stage: 'start' })
    const info = await getLatestDumpInfo()
    const meta = await getArchiveMeta()
    const db = await getArchiveDb()
    const schemaOutdated = (meta?.schemaVersion ?? 1) < ARCHIVE_SCHEMA_VERSION
    if (meta?.sha256 === info.sha256 && tableExists(db, 'arc_subjects') && !schemaOutdated) {
      onProgress?.({ stage: 'done', message: '已是最新版本' })
      return { status: 'up-to-date', version: info.name, size: info.size, date: info.date }
    }

    const dumpPath = getDumpPath()
    const extractDir = getExtractDir()

    // 若磁盘上已有与最新 digest 一致的 dump.zip（例如上次下载成功但后续步骤失败），直接复用，避免重复下载 409MB
    let existingSha: string | null = null
    if (existsSync(dumpPath)) {
      try {
        existingSha = await fileSha256(dumpPath)
      } catch {
        existingSha = null
      }
    }
    if (existingSha === info.sha256) {
      onProgress?.({ stage: 'download', downloaded: info.size, total: info.size })
    } else {
      // 清理可能的残留后重新下载
      if (existsSync(dumpPath)) rmSync(dumpPath, { force: true })
      onProgress?.({ stage: 'download', downloaded: 0, total: info.size })
      await downloadDump(info.url, dumpPath, info.sha256, onProgress)
    }
    onProgress?.({ stage: 'extract' })
    await extractDump(dumpPath, extractDir)
    onProgress?.({ stage: 'ingest' })
    await ingestDump(extractDir, onProgress)

    // 入库产生的大量写入都落在 WAL 中。立即 checkpoint 合并回主库并截断 WAL 文件，
    // 避免进程被强杀（taskkill /IM electron.exe /F）导致 WAL 永久膨胀
    // （实测曾涨到 ~952MB，而主库仅 1.5GB）。仅影响 WAL 文件，不触碰任何用户数据。
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* checkpoint 失败不影响更新结果，忽略 */
    }

    await setArchiveMeta({
      version: info.name,
      sha256: info.sha256,
      size: info.size,
      date: info.date,
      lastSuccessAt: Date.now(),
      status: 'ok',
      lastError: null,
      schemaVersion: ARCHIVE_SCHEMA_VERSION
    })

    // 清理：保留 dump.zip（便于后续 schema 升级时直接解压重入库，免去重复下载 409MB），仅删解压目录省空间
    try {
      rmSync(extractDir, { recursive: true, force: true })
    } catch {
      /* 忽略清理失败 */
    }
    onProgress?.({ stage: 'done', message: schemaOutdated ? '已更新（含图片）' : '更新完成' })
    return { status: 'updated', version: info.name, size: info.size, date: info.date }
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e)
    await setArchiveMeta({ status: 'error', lastError: msg }).catch(() => {})
    onProgress?.({ stage: 'error', message: msg })
    return { status: 'error', error: msg }
  } finally {
    isUpdating = false
  }
}

/** 应用启动时调用：若距上次成功更新超过 30 天则后台静默更新 */
export async function maybeAutoUpdateArchive(): Promise<void> {
  if (isUpdating) return
  try {
    // 读取自动更新开关：默认为开启；settings 表中值为 '0' 表示用户已关闭
    const flag = await getSetting('archiveAutoUpdate')
    if (flag === '0') {
      console.log('[archive] 自动更新已关闭（archiveAutoUpdate=0），跳过静默更新')
      return
    }
    const meta = await getArchiveMeta()
    const last = meta?.lastSuccessAt
    const THIRTY_DAYS = 30 * 24 * 3600 * 1000
    if (!last || Date.now() - last > THIRTY_DAYS) {
      console.log('[archive] 触发每月自动更新')
      await updateArchive()
    }
  } catch (e) {
    console.warn('[archive] 自动更新跳过：', e)
  }
}

/**
 * 删除整个离线数据库目录（bangumi-archive/，含 db / wal / shm / dump.zip / extract）。
 * 先关闭当前 Archive 连接释放文件句柄，再递归删除磁盘目录；
 * 下次需要时由 getArchiveDb 懒加载重新创建空目录与连接。不触碰用户个人库（bangumi-for-pc.db）。
 */
export async function deleteArchive(): Promise<void> {
  // 关闭并释放当前连接（若有）
  if (archiveDbPromise) {
    try {
      const db = await archiveDbPromise
      db.close()
    } catch {
      /* 连接可能已异常，忽略 */
    }
    archiveDbPromise = null
  }
  // 注意：不要调用 getArchiveDir()（它会 mkdirSync 重建空目录），直接算路径删除
  const dir = join(app.getPath('userData'), 'bangumi-archive')
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn('[deleteArchive] 删除离线库目录失败（忽略）：', e)
  }
}

// ---------- 对外：查询 ----------
/** 离线兜底：按 Bangumi id 从本地 Archive 库取作品简介（离线时详情页也能显示简介） */
export async function getArchiveSubjectSummary(bangumiId: string | number): Promise<string | null> {
  if (!existsSync(join(getArchiveDir(), 'bangumi-archive.db'))) return null
  try {
    const db = await getArchiveDb()
    if (!tableExists(db, 'arc_subjects')) return null
    const row = db.prepare('SELECT summary FROM arc_subjects WHERE id = ?').get(Number(bangumiId))
    const s = (row?.summary || '') as string
    return s.trim() ? s : null
  } catch {
    return null
  }
}

export async function searchSubjects(
  query: string,
  type?: number,
  limit = 50
): Promise<ArchiveSubjectSearch[]> {
  const db = await getArchiveDb()
  if (!tableExists(db, 'arc_subjects')) return []
  const like = `%${query}%`
  const params: any[] = [like, like]
  let sql = 'SELECT id, type, name, name_cn, score, summary FROM arc_subjects WHERE (name LIKE ? OR name_cn LIKE ?)'
  if (type) {
    sql += ' AND type = ?'
    params.push(type)
  }
  sql += ' ORDER BY score DESC LIMIT ?'
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    name_cn: r.name_cn ?? '',
    score: typeof r.score === 'number' ? r.score : null,
    summary: (r.summary || '').slice(0, 120)
  }))
}

/**
 * 离线兜底：按标签过滤作品。arc_subjects.tags 是 JSON 数组 [{name,count}]。
 * 先 LIKE 粗筛缩小范围，再用 JSON 精确校验 name 完全相等，避免大小写/子串误匹配。
 * 返回含 category（细分类目，书籍按 Bangumi platform/tags 细分 小说/漫画）、rank、date，
 * 供渲染层做筛选与排序；image_url 离线库恒空，由渲染层异步补图。
 * 注：已剔除 type=6（三次元/真人），rank=0 视为未上榜（排序时沉底）。
 */
export async function getArchiveSubjectsByTag(
  tag: string,
  limit = 300
): Promise<ArchiveTagSubject[]> {
  const db = await getArchiveDb()
  if (!tableExists(db, 'arc_subjects')) return []
  const need = tag.trim()
  if (!need) return []
  // 粗筛：tags 列含 "name":"..." 片段即纳入，后续 JS 精确校验
  const like = `%${need.replace(/["\\%_]/g, '')}%`
  const rows = db
    .prepare(
      `SELECT id, type, name, name_cn, score, summary, image_url, rank, date, platform, infobox, tags
       FROM arc_subjects WHERE tags LIKE ? ORDER BY score DESC LIMIT ?`
    )
    .all(like, limit * 4 + 50) as any[]
  const out: ArchiveTagSubject[] = []
  for (const r of rows) {
    let matched = false
    try {
      const tags = JSON.parse(r.tags || '[]')
      matched = Array.isArray(tags) && tags.some((t: any) => t && t.name === need)
    } catch {
      matched = false
    }
    if (!matched) continue
    // 剔除三次元/真人（type 6）——用户要求只保留 ACGN 内容
    if (r.type === 6) continue
    // 细分类目：动画(2)/游戏(4) 直接定；书籍(1) 需细分 小说/漫画（平台优先，缺失按 tag 计数）；
    // 音乐(3) 等无对应栏目 → other。
    let category = 'other'
    if (r.type === 2) category = 'anime'
    else if (r.type === 4) category = 'galgame'
    else if (r.type === 1) {
      let tagArr: any[] = []
      try {
        tagArr = JSON.parse(r.tags || '[]')
      } catch {
        tagArr = []
      }
      // Archive 的 platform 是数字 code，需先转成字符串再交给 classifyBookCategory；
      // 已知 code 直接定类，其余按 tag 计数兜底（与项目搜索细分逻辑一致）。
      const code = typeof r.platform === 'number' ? r.platform : Number(r.platform)
      const platStr = BOOK_PLATFORM_CATEGORY[code]
      category = classifyBookCategory(
        platStr
          ? { platform: platStr, tags: tagArr, infobox: r.infobox }
          : { platform: undefined, tags: tagArr, infobox: r.infobox }
      )
    }
    out.push({
      id: r.id,
      type: r.type,
      category,
      name: r.name,
      name_cn: r.name_cn ?? '',
      score: typeof r.score === 'number' ? r.score : null,
      // Archive 对「未上榜」作品存 rank=0（而非 null），必须 >0 才算有效排名，
      // 否则未上榜的会排到最前。=> rank 越小越靠前；未上榜(null)沉底。
      rank: typeof r.rank === 'number' && r.rank > 0 ? r.rank : null,
      date: r.date || null,
      summary: (r.summary || '').slice(0, 120),
      image_url: r.image_url || ''
    })
    if (out.length >= limit) break
  }
  // 封面回填：Archive 的 image_url 列全量恒空，但用户已同步到主库 subjects 的作品
  // 99% 都带封面（来自在线同步）。这里按 Bangumi id 关联主库，把已同步作品的封面
  // 直接回填到结果里 → 标签窗口「同步过的作品」秒显封面，无需逐部联网拉取。
  // 主库查不到（未同步）的作品，仍由原在线补图兜底（`ensureArchiveSubjectCovers`）。
  if (out.length) {
    try {
      const mainDb = await getDb()
      const ids = out.map((o) => o.id)
      const placeholders = ids.map(() => '?').join(',')
      const coverRows = mainDb
        .prepare(
          `SELECT provider_subject_id, image_url FROM subjects
           WHERE provider = 'bangumi' AND provider_subject_id IN (${placeholders})`
        )
        .all(...ids.map(String)) as { provider_subject_id: string; image_url: string }[]
      const coverMap = new Map<string, string>()
      for (const r of coverRows) {
        if (r.image_url) coverMap.set(r.provider_subject_id, r.image_url)
      }
      for (const o of out) {
        const u = coverMap.get(String(o.id))
        if (u) o.image_url = u
      }
    } catch {
      // 主库不可用（如 better-sqlite3 未就绪）不影响标签列表——封面走在线补图兜底
    }
  }
  return out
}

/**
 * 离线 Archive 库 `arc_subjects.image_url` 列**全量恒空**（JSONL 导出无 images 字段），
 * 故按标签列出的作品默认都没有封面。本函数为这些作品**匿名从 Bangumi v0 联网补图**：
 *   1. 先用 IN 查询把「已有 image_url」的 id 直接命中（理论上 Archive 全空，几乎都走第 2 步）；
 *   2. 其余 id 用并发池（8）逐个匿名 `GET /v0/subjects/{id}` 取封面，成功则**回写 Archive**
 *      （下次打开同标签即秒显，不再联网）；失败（网络/限流/404）静默跳过，前端保留「无封面」占位。
 * 返回 { [id]: url }（仅含成功取到封面的 id），供前端就地补图。
 * 注意：这是主进程网络调用，渲染层需经 IPC；离线/无网环境会整体失败、返回空对象，列表仍可正常显示（只是无封面）。
 */
export async function ensureArchiveSubjectCovers(ids: number[]): Promise<Record<number, string>> {
  const result: Record<number, string> = {}
  const uniq = [...new Set(ids)].filter((x) => typeof x === 'number' && x > 0)
  if (!uniq.length) return result
  let db: any = null
  try {
    db = await getArchiveDb()
  } catch {
    db = null
  }
  if (!db || !tableExists(db, 'arc_subjects')) return result

  // 先读已有封面（Archive 当前全空，这里只是兜底，未来若补充图则免联网）
  const placeholders = uniq.map(() => '?').join(',')
  const existing = db
    .prepare(`SELECT id, image_url FROM arc_subjects WHERE id IN (${placeholders})`)
    .all(...uniq) as any[]
  const needFetch: number[] = []
  for (const r of existing) {
    if (r.image_url && typeof r.image_url === 'string' && r.image_url.trim()) {
      result[r.id] = r.image_url
    } else {
      needFetch.push(r.id)
    }
  }
  // 不在库内的 id（理论上不会，因来自 tag 查询）也补抓
  const known = new Set(existing.map((r) => r.id))
  for (const id of uniq) if (!known.has(id)) needFetch.push(id)

  if (!needFetch.length) return result

  // 并发池 16：封面慢的主因是逐个 GET 全量 subject 详情（仅取 images 字段）。
  // 提高到 16 显著缩短等待；单条失败静默跳过，已缓存的由 IN 查询跳过，不会重复抓。
  const POOL = 16
  let cursor = 0
  const worker = async () => {
    while (cursor < needFetch.length) {
      const id = needFetch[cursor++]
      try {
        const url = await getSubjectCover(id)
        if (url) {
          result[id] = url
          // 回写 Archive，下次秒显
          try {
            db.prepare('UPDATE arc_subjects SET image_url = ? WHERE id = ?').run(url, id)
          } catch {
            /* 回写失败不影响本次显示 */
          }
        }
      } catch {
        /* 单条失败跳过，保留占位 */
      }
    }
  }
  const workers = Array.from({ length: Math.min(POOL, needFetch.length) }, () => worker())
  await Promise.all(workers)
  return result
}

/**
 * 用于人物卡「参与作品 / 出演角色」按时间排序。
 * - 离线库不存在或该行无 date 时，对应 id 不在返回的 Map 中（调用方用哨兵兜底到末尾）。
 * - 一次 IN 查询批量取，避免逐条查询。
 */
export async function getArchiveSubjectDates(ids: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>()
  const uniq = [...new Set(ids)].filter((x) => typeof x === 'number' && x > 0)
  if (!uniq.length) return m
  if (!existsSync(join(getArchiveDir(), 'bangumi-archive.db'))) return m
  try {
    const db = await getArchiveDb()
    if (!tableExists(db, 'arc_subjects')) return m
    const placeholders = uniq.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT id, date FROM arc_subjects WHERE id IN (${placeholders})`)
      .all(...uniq) as any[]
    for (const r of rows) {
      if (r?.date) m.set(Number(r.id), String(r.date))
    }
  } catch (e) {
    console.warn('[getArchiveSubjectDates] 读离线库失败（忽略，回退 API 原序）：', e)
  }
  return m
}

/** 从离线库读取某作品的角色与关联作品（用于实时 API 不可用时的兜底）。
 *  subjectId 为 Bangumi 条目 id（provider_subject_id），subjectType 为 Bangumi subject type。 */
export async function getArchiveExtra(
  subjectId: number,
  subjectType: number
): Promise<{ characters: SubjectCharacter[]; relations: SubjectRelation[] }> {
  const db = await getArchiveDb()
  if (!tableExists(db, 'arc_subjects')) return { characters: [], relations: [] }

  const charRows = db
    .prepare(
      `SELECT sc.character_id AS id, sc.type AS relType, c.name AS name, c.name_cn AS name_cn, c.image_url AS image_url, c.summary AS summary, c.infobox AS infobox
       FROM arc_subject_characters sc JOIN arc_characters c ON c.id = sc.character_id
       WHERE sc.subject_id = ? ORDER BY sc.type, sc.ord`
    )
    .all(subjectId) as any[]
  const characters: SubjectCharacter[] = charRows.map((r) => {
    const actorRows = db
      .prepare(
        `SELECT p.id AS id, p.name AS name, p.name_cn AS name_cn, p.infobox AS infobox
         FROM arc_person_characters pc JOIN arc_persons p ON p.id = pc.person_id
         WHERE pc.subject_id = ? AND pc.character_id = ?`
      )
      .all(subjectId, r.id) as any[]
    const actors = actorRows.map((a) => {
      // CV 中文名：infobox 简体中文名 > name_cn(离线库占位列，恒空) > 原名
      const cn = extractCnFromWikiInfobox(a.infobox) || ''
      return {
        id: a.id,
        name: cn || a.name_cn || a.name || '',
        nameCn: cn
      }
    })
    // 角色中文名：infobox 简体中文名 > name_cn(恒空) > 原名；nameCn 明确记录是否真取到中文
    const cn = extractCnFromWikiInfobox(r.infobox) || ''
    return {
      id: r.id,
      name: cn || r.name_cn || r.name || '',
      nameCn: cn,
      image: r.image_url ?? undefined,
      relation: characterRelationLabel(r.relType),
      actors
    }
  })

  const relRows = db
    .prepare(
      `SELECT sr.relation_type AS relation_type, sr.related_subject_id AS id,
              s.name AS name, s.name_cn AS name_cn, s.type AS type, s.score AS score, s.image_url AS image_url
       FROM arc_subject_relations sr JOIN arc_subjects s ON s.id = sr.related_subject_id
       WHERE sr.subject_id = ? ORDER BY sr.ord`
    )
    .all(subjectId) as any[]
  const relations: SubjectRelation[] = relRows.map((r) => {
    // 关联条目中文名：subject 顶层 name_cn（Archive 真有此字段）> infobox 简体中文名 > 原名
    const cn = r.name_cn && r.name_cn.trim() ? r.name_cn : extractCnFromWikiInfobox(r.infobox) || ''
    return {
      id: r.id,
      name: cn || r.name || '',
      nameCn: cn,
      image: r.image_url ?? undefined,
      type: r.type ?? 0,
      relation: relationLabel(subjectType, r.relation_type)
    }
  })

  return { characters, relations }
}
