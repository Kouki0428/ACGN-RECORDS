import electron from 'electron'
const { safeStorage, shell } = electron
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { getDb } from '../db/connection'
import { encrypt, decrypt } from '../crypto/vault'
import { getSetting, setSetting } from '../db/repositories/settings.repository'
import { safeFetch } from '../api/http'
import type { AuthStatus } from '../../../../shared/types'
import { dbg } from '../debugLog'

// 合规 User-Agent（Bangumi 会拦截默认 UA，必须带 开发者ID/应用名/版本）
export const UA = 'yhq18/ACGN-Records/0.1 (https://github.com/yhq18/acgn-records)'

const API_BASE = 'https://api.bgm.tv/v0'
const AUTHORIZE_URL = 'https://bgm.tv/oauth/authorize'
const TOKEN_URL = 'https://bgm.tv/oauth/access_token'
const REDIRECT_URI = 'http://localhost:7321/oauth/callback'
const PROVIDER = 'bangumi'

/**
 * 开发者应用凭据（用户在 Bangumi 后台注册的应用）。
 * 此处为首次启动的默认播种值；运行时存于 settings 表（经 safeStorage 加密），
 * 用户可在「设置」中查看/修改，源码中的字面量仅作为一次性种子。
 */
const DEFAULT_APP_ID = 'bgm68506a77cc9f3feac'
const DEFAULT_APP_SECRET = '15ed6976037812276fce26fccd6c1599'

export interface BangumiAccount {
  username: string | null
  userId: number | null
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
}

export type TokenMethod = 'oauth' | 'token'

export interface OAuthTokenData {
  access_token: string
  refresh_token?: string
  expires_in?: number
  user_id?: number
  username?: string
}

/* ----------------------------- App 凭据管理 ----------------------------- */

/** 读取 App ID / Secret（解密自 settings）；缺失时用默认值播种并加密保存。 */
export async function getAppCredentials(): Promise<{ appId: string; appSecret: string }> {
  let appId = await getSetting('bgm_app_id')
  let secret = await getSetting('bgm_app_secret')
  if (!appId || !secret) {
    appId = appId ? decrypt(appId) : DEFAULT_APP_ID
    secret = secret ? decrypt(secret) : DEFAULT_APP_SECRET
    await setSetting('bgm_app_id', encrypt(appId))
    await setSetting('bgm_app_secret', encrypt(secret))
  } else {
    appId = decrypt(appId)
    secret = decrypt(secret)
  }
  return { appId, appSecret: secret }
}

/** 保存用户在设置页填写的 App 凭据（加密存储）。 */
export async function saveAppCredentials(appId: string, secret: string): Promise<void> {
  if (!appId.trim() || !secret.trim()) throw new Error('App ID 与 App Secret 均不能为空')
  await setSetting('bgm_app_id', encrypt(appId.trim()))
  await setSetting('bgm_app_secret', encrypt(secret.trim()))
}

/* ----------------------------- 个人令牌模式 ----------------------------- */

/**
 * 保存用户从 https://next.bgm.tv/demo/access-token 生成的个人令牌。
 * token 经 safeStorage 加密后存入 accounts 表；保存时尝试用令牌拉取用户名缓存。
 */
export async function saveToken(plainToken: string): Promise<void> {
  const token = plainToken.trim()
  if (!token) throw new Error('令牌不能为空')

  const db = await getDb()
  const enc = encrypt(token)

  let username: string | null = null
  let userId: number | null = null
  try {
    const meResp = await safeFetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA, Accept: 'application/json' }
    })
    if (meResp.ok) {
      const me = (await meResp.json()) as { username?: string; nickname?: string; id?: number }
      username = me.username ?? me.nickname ?? null
      userId = me.id ?? null
    }
  } catch {
    /* 网络异常时不影响令牌保存 */
  }

  const existing = db
    .prepare("SELECT id FROM accounts WHERE provider = ? ORDER BY id DESC LIMIT 1")
    .get(PROVIDER) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE accounts
       SET username = ?, user_id = ?, access_token = ?, refresh_token = NULL, expires_at = NULL, updated_at = strftime('%s','now')
       WHERE id = ?`
    ).run(username, userId, enc, existing.id)
  } else {
    db.prepare(
      `INSERT INTO accounts (provider, username, user_id, access_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))`
    ).run(PROVIDER, username, userId, enc)
  }
}

/** 清除本地保存的 Bangumi 令牌（退出登录，OAuth 与个人令牌通用） */
export async function clearToken(): Promise<void> {
  try {
    const db = await getDb()
    db.prepare("DELETE FROM accounts WHERE provider = ?").run(PROVIDER)
  } catch {
    /* 忽略 */
  }
}

/* ----------------------------- OAuth 流程 ----------------------------- */

function buildAuthorizeUrl(appId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state,
    // 请求 refresh_token（离线访问），否则 Bangumi 可能只返回 access_token
    access_type: 'offline'
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

/** 本地回调服务：监听 7321，校验 state 后把授权码 resolve 出来。 */
function listenForCallback(state: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url ?? '', 'http://localhost:7321')
        if (u.pathname !== '/oauth/callback') {
          res.writeHead(404)
          res.end()
          return
        }
        const cbState = u.searchParams.get('state')
        const code = u.searchParams.get('code')
        const err = u.searchParams.get('error')
        const answer = (status: number, html: string) => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
        }
        if (err) {
          answer(400, '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ 授权失败</h2><p>你拒绝了授权或发生错误。</p></body></html>')
          cleanup()
          reject(new Error('Bangumi 授权被拒绝：' + err))
          return
        }
        if (cbState !== state) {
          answer(400, '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ 校验失败</h2><p>state 不匹配，已中止。</p></body></html>')
          cleanup()
          reject(new Error('OAuth state 不匹配'))
          return
        }
        if (!code) {
          answer(400, '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ 缺少授权码</h2></body></html>')
          cleanup()
          reject(new Error('回调缺少 code'))
          return
        }
        answer(200, '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>✅ 登录成功</h2><p>已获取 Bangumi 授权，可关闭此页面返回应用。</p></body></html>')
        cleanup()
        resolve(code)
      } catch (e) {
        cleanup()
        reject(e)
      }
    })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('登录超时（5 分钟内未完成授权）'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      server.close()
    }

    server.once('error', (e: NodeJS.ErrnoException) => {
      cleanup()
      if (e.code === 'EADDRINUSE') {
        reject(new Error('端口 7321 被占用（可能有其他登录进行中），请稍后再试'))
      } else {
        reject(e)
      }
    })

    // 监听所有本机接口，兼容 localhost 解析到 ::1 (IPv6) 或 127.0.0.1 的情况
    server.listen(7321)
  })
}

/** 用授权码换取 access_token（标准 OAuth2 授权码流程）。 */
async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string
): Promise<OAuthTokenData> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: appId,
    client_secret: appSecret,
    code,
    redirect_uri: REDIRECT_URI
  })
  const res = await safeFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': UA
    },
    body: body.toString()
  })
  const data = (await res.json()) as OAuthTokenData & { error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`换取令牌失败 (HTTP ${res.status})${data.error ? '：' + data.error : ''}`)
  }
  return data
}

/** 保存 OAuth 换得的令牌（access/refresh 均加密；expires_at 存绝对毫秒时间）。 */
async function saveOAuthToken(data: OAuthTokenData): Promise<void> {
  const db = await getDb()
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null
  const encAccess = encrypt(data.access_token)
  const encRefresh = data.refresh_token ? encrypt(data.refresh_token) : null

  // best-effort：用新令牌调 /me 补全用户名（token 响应可能只含 user_id）
  let username = data.username ?? null
  let userId = data.user_id ?? null
  try {
    const meResp = await safeFetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': UA, Accept: 'application/json' }
    })
    if (meResp.ok) {
      const me = (await meResp.json()) as { username?: string; nickname?: string; id?: number }
      username = me.username ?? me.nickname ?? username
      userId = me.id ?? userId
    }
  } catch {
    /* 忽略，token 响应里的 user_id/username 已足够 */
  }

  const existing = db
    .prepare("SELECT id FROM accounts WHERE provider = ? ORDER BY id DESC LIMIT 1")
    .get(PROVIDER) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE accounts
       SET username = ?, user_id = ?, access_token = ?, refresh_token = ?, expires_at = ?, updated_at = strftime('%s','now')
       WHERE id = ?`
    ).run(username, userId, encAccess, encRefresh, expiresAt, existing.id)
  } else {
    db.prepare(
      `INSERT INTO accounts (provider, username, user_id, access_token, refresh_token, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))`
    ).run(PROVIDER, username, userId, encAccess, encRefresh, expiresAt)
  }
}

/** refresh_token 刷新 access_token；返回新的 access_token 并更新本地。 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { appId, appSecret } = await getAppCredentials()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: appId,
    client_secret: appSecret,
    refresh_token: refreshToken
  })
  const res = await safeFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': UA
    },
    body: body.toString()
  })
  const data = (await res.json()) as OAuthTokenData & { error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`刷新令牌失败 (HTTP ${res.status})${data.error ? '：' + data.error : ''}`)
  }
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null
  const db = await getDb()
  const row = db
    .prepare('SELECT id FROM accounts WHERE provider = ? ORDER BY id DESC LIMIT 1')
    .get(PROVIDER) as { id: number } | undefined
  if (row) {
    db.prepare(
      `UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = strftime('%s','now') WHERE id = ?`
    ).run(encrypt(data.access_token), encrypt(data.refresh_token ?? refreshToken), expiresAt, row.id)
  }
  return data.access_token
}

/**
 * 启动 OAuth 登录：打开浏览器授权页 → 等待本地回调 → 换令牌 → 保存 → 返回状态。
 * 渲染层只需 await auth.login() 即可。
 */
export async function beginOAuthLogin(): Promise<AuthStatus> {
  const { appId, appSecret } = await getAppCredentials()
  const state = randomBytes(16).toString('hex')
  const authorizeUrl = buildAuthorizeUrl(appId, state)
  shell.openExternal(authorizeUrl)
  const code = await listenForCallback(state)
  const tokenData = await exchangeCodeForToken(code, appId, appSecret)
  await saveOAuthToken(tokenData)
  return getAuthStatus()
}

/* ----------------------------- 状态与取用 ----------------------------- */

/** 返回当前登录状态（loggedIn 取决于是否存在已保存的令牌；method 区分来源）。 */
export async function getAuthStatus(): Promise<AuthStatus> {
  const acct = await getBangumiAccount()
  dbg('getAuthStatus acctPresent=', !!acct, 'hasAccessToken=', !!(acct && acct.accessToken))
  if (acct?.accessToken) {
    const method: TokenMethod = acct.refreshToken ? 'oauth' : 'token'
    return {
      loggedIn: true,
      username: acct.username ?? undefined,
      userId: acct.userId ?? undefined,
      method
    }
  }
  return { loggedIn: false }
}

/** 读取已存储的 Bangumi 账号（token 解密）。 */
export async function getBangumiAccount(): Promise<BangumiAccount | null> {
  try {
    const db = await getDb()
    const row = db
      .prepare(
        'SELECT username, user_id, access_token, refresh_token, expires_at FROM accounts WHERE provider = ? ORDER BY id DESC LIMIT 1'
      )
      .get(PROVIDER) as
      | {
          username: string | null
          user_id: number | null
          access_token: string
          refresh_token: string | null
          expires_at: number | null
        }
      | undefined
    if (!row) return null
    return {
      username: row.username,
      userId: row.user_id,
      accessToken: decrypt(row.access_token),
      refreshToken: row.refresh_token ? decrypt(row.refresh_token) : null,
      expiresAt: row.expires_at
    }
  } catch {
    return null
  }
}

/**
 * 返回当前可用的 access_token。
 * - 个人令牌：长期有效，直接返回。
 * - OAuth 令牌：临近过期则用 refresh_token 静默刷新。
 * 返回 null 表示未配置令牌。syncEngine 与 bangumi 适配器依赖此签名。
 */
// 短期内存缓存：同一时刻大量 IPC（如悬浮窗并发拉取详情）会反复调用 getValidToken，
// 每次都读库 + 解密。30s 内的重复调用直接返回上次结果，显著降低 DB 压力（令牌临近过期
// 时刷新也走同一条路径，30s 窗口足够短，不会挡住真实刷新 / 登录态变更）。
let tokenMemo: { value: string | null; ts: number } | null = null
const TOKEN_MEMO_TTL = 30_000

async function computeValidToken(): Promise<string | null> {
  const acct = await getBangumiAccount()
  dbg('getValidToken acctPresent=', !!acct, 'hasAccessToken=', !!(acct && acct.accessToken), 'expiresAt=', acct?.expiresAt)
  if (!acct?.accessToken) return null
  // 个人令牌（无过期时间）
  if (!acct.expiresAt) return acct.accessToken
  // OAuth 令牌：5 分钟缓冲内直接返回
  if (acct.expiresAt > Date.now() + 5 * 60 * 1000) return acct.accessToken
  // 临近过期，尝试刷新
  if (acct.refreshToken) {
    try {
      return await refreshAccessToken(acct.refreshToken)
    } catch {
      return acct.accessToken
    }
  }
  return acct.accessToken
}

export async function getValidToken(): Promise<string | null> {
  const now = Date.now()
  if (tokenMemo && now - tokenMemo.ts < TOKEN_MEMO_TTL) return tokenMemo.value
  const value = await computeValidToken()
  tokenMemo = { value, ts: now }
  return value
}
