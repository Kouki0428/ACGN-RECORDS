import electron from 'electron'
const { BrowserWindow } = electron
import { getValidToken } from '../auth/oauth'

// Cloudflare Turnstile site-key（来自 next.bgm.tv 域名，单集评论 p1 POST 必填项）
const TURNSTILE_SITE_KEY = '0x4AAAAAAABkMYinukE8nzYS'
const TURNSTILE_API = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

let activeWin: BrowserWindow | null = null

/**
 * 用隐藏 BrowserWindow 内嵌 Cloudflare Turnstile 控件，best-effort 取得 token。
 * - 仅在已登录（有有效 Bearer）时有意义：单集评论 POST 需 token + turnstile 双校验。
 * - 控件通常为「隐形」自动通过；若弹出需交互的挑战（窗口隐藏、用户无法操作），会超时返回 null。
 * - 任何失败（超时 / 无令牌 / 被 Cloudflare 拦截 / 窗口异常）一律返回 null，
 *   由调用方回退「仅本地存储」，绝不阻塞用户发表评论。
 */
export async function solveTurnstile(timeoutMs = 20000): Promise<string | null> {
  // 未登录则无必要求解（POST 会因缺 Bearer 失败），直接回退本地存储
  const token = await getValidToken()
  if (!token) return null

  return new Promise((resolve) => {
    let settled = false
    let poll: ReturnType<typeof setInterval> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (val: string | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
      try {
        if (win && !win.isDestroyed()) win.close()
      } catch {
        /* 忽略关闭异常 */
      }
      if (activeWin === win) activeWin = null
      resolve(val)
    }

    let win: BrowserWindow
    try {
      win = new BrowserWindow({
        show: false,
        width: 360,
        height: 280,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      })
    } catch {
      resolve(null)
      return
    }
    activeWin = win

    timer = setTimeout(() => finish(null), timeoutMs)
    win.on('closed', () => finish(null))

    // 轮询页面上控件写入的 token（隐形挑战自动通过后会写入 window.__turnstileToken）
    const startPoll = () => {
      poll = setInterval(async () => {
        try {
          const t = (await win.webContents.executeJavaScript(
            'window.__turnstileToken || null'
          )) as string | null
          if (t) finish(t)
        } catch {
          /* 页面尚未就绪，忽略 */
        }
      }, 400)
    }

    win.webContents.on('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript(`
          (function(){
            if (window.__turnstileInjected) return;
            window.__turnstileInjected = true;
            window.__onTurnstile = function(t){ window.__turnstileToken = t; };
            window.__onTurnstileExpired = function(){ window.__turnstileToken = null; };
            var s = document.createElement('script');
            s.src = '${TURNSTILE_API}';
            s.async = true; s.defer = true;
            document.head.appendChild(s);
            var d = document.createElement('div');
            d.className = 'cf-turnstile';
            d.setAttribute('data-sitekey', '${TURNSTILE_SITE_KEY}');
            d.setAttribute('data-callback', '__onTurnstile');
            d.setAttribute('data-expired-callback', '__onTurnstileExpired');
            document.body.appendChild(d);
          })();
        `)
        startPoll()
      } catch {
        /* 注入失败：交由超时兜底 */
      }
    })

    // 用 about:blank 作为中性宿主注入控件（避开 data: URL 的 CSP 限制）。
    // Turnstile 的 token 与 sitekey 绑定（非严格绑定 origin），足够供 p1 POST 校验。
    win.loadURL('about:blank')
  })
}

/** 进程退出时清理可能遗留的隐藏窗口 */
export function disposeTurnstile(): void {
  if (activeWin && !activeWin.isDestroyed()) {
    try {
      activeWin.close()
    } catch {
      /* 忽略 */
    }
    activeWin = null
  }
}
