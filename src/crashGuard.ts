// 渲染进程崩溃兜底：
// - 挂载失败（同步 try/catch）→ 用原生 DOM 渲染「恢复页」（不依赖 Vue/CSS 是否存活）
// - 运行期未捕获异常 / Promise reject → Toast 轻提示（节流），不打断使用
// 所有错误均打印到控制台，便于 dev 排查。

let lastToastAt = 0
let mounted = false

/** 软错误：应用已挂载时的运行期异常。Toast 节流（5s 一条），避免错误风暴刷屏。 */
function softError(err: unknown) {
  console.error('[crashGuard]', err)
  if (!mounted) return
  const now = Date.now()
  if (now - lastToastAt < 5000) return
  lastToastAt = now
  try {
    // 动态引用避免初始化循环依赖；toast 自身异常绝不能再抛
    import('./composables/useToast').then(({ useToast }) => {
      useToast().err('发生了一个内部错误，已记录到控制台')
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/** 致命错误：挂载失败。原生 DOM 渲染恢复页，提供自救出口。 */
function renderFatalScreen(err: unknown) {
  const root = document.getElementById('app')
  if (!root) return
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  root.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#14171c;color:#e9edf3;">
      <div style="max-width:560px;padding:36px;text-align:center;">
        <div style="font-size:44px;line-height:1;margin-bottom:14px;">⚠</div>
        <h1 style="font-size:19px;margin:0 0 8px;">应用启动失败</h1>
        <p style="color:#93a0b1;font-size:13px;margin:0 0 22px;">界面未能正常加载，可尝试以下操作：</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button id="__cg_reload" style="padding:9px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,#5b9dff,#6be3ff);color:#fff;font-weight:600;cursor:pointer;">重新加载</button>
          <button id="__cg_clear" style="padding:9px 18px;border-radius:8px;border:1px solid #2c333d;background:#252c37;color:#e9edf3;cursor:pointer;">清除本地缓存并重载</button>
          <button id="__cg_copy" style="padding:9px 18px;border-radius:8px;border:1px solid #2c333d;background:#252c37;color:#e9edf3;cursor:pointer;">复制错误信息</button>
        </div>
        <pre id="__cg_detail" style="margin-top:24px;text-align:left;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;font-size:11px;color:#93a0b1;background:#1c2129;border:1px solid #2c333d;border-radius:8px;padding:12px;">${escapeHtml(detail)}</pre>
      </div>
    </div>`
  const reload = () => location.reload()
  document.getElementById('__cg_reload')?.addEventListener('click', reload)
  document.getElementById('__cg_clear')?.addEventListener('click', () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    reload()
  })
  document.getElementById('__cg_copy')?.addEventListener('click', function () {
    navigator.clipboard
      .writeText(detail)
      .then(() => {
        const btn = this as HTMLButtonElement
        btn.textContent = '已复制'
      })
      .catch(() => {})
  })
}

/**
 * 安装全局崩溃守卫并执行挂载。
 * @param mount 实际的 app.mount 调用（由调用方组装 pinia/router）
 * @param app Vue 应用实例（用于注册 errorHandler，可选）
 */
export function installCrashGuard(mount: () => void, app?: { config: { errorHandler?: unknown } }) {
  window.addEventListener('unhandledrejection', (e) => {
    softError(e.reason)
  })
  // capture 阶段捕获资源加载错误之外的脚本错误；无 error/message 的为 <img> 等资源事件，忽略
  window.addEventListener(
    'error',
    (e) => {
      if ((e instanceof ErrorEvent && (e.error || e.message)) || e.error) {
        softError(e.error ?? e.message)
      }
    },
    true
  )
  if (app) {
    ;(app.config as { errorHandler?: unknown }).errorHandler = (err: unknown) => {
      softError(err)
    }
  }
  try {
    mount()
    mounted = true
  } catch (err) {
    console.error('[crashGuard] 挂载失败', err)
    renderFatalScreen(err)
  }
}
