import electron from 'electron'
const { protocol } = electron
import { safeFetch } from './http'

/**
 * Bangumi 图片 CDN（lain.bgm.tv 等）在渲染进程直连常被墙/超时，导致 <img> 空白。
 * 这里注册一个主进程图片代理协议：renderer 把图片地址编码进 acgn-img://，由主进程
 * 经 safeFetch（走系统/环境代理）下载图片字节并流式返回，<img> 不再直连 CDN。
 *
 * 这样既复用 Archive 下载同款的代理配置，又让所有 Bangumi 图片（封面/头像/搜索结果）
 * 在主进程侧统一拉取，渲染端只认 acgn-img://，规避混合内容/跨域与直连失败问题。
 */

/** 必须在 app ready 之前调用，声明 acgn-img 为特权 scheme（可用于 <img>/fetch、可流式）。 */
export function registerImageProxySchemes(): void {
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'acgn-img',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          bypassCSP: true
        }
      }
    ])
  } catch (e) {
    console.warn('[imgproxy] registerSchemesAsPrivileged 失败（可忽略）：', e)
  }
}

async function streamToBuffer(body?: ReadableStream<Uint8Array>): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** 在 app ready 之后调用，真正接管 acgn-img:// 请求。 */
export function registerImageProxy(): void {
  protocol.handle('acgn-img', async (request) => {
    const requestUrl = request.url
    try {
      const target = decodeURIComponent(requestUrl.replace(/^acgn-img:\/\//, ''))
      if (!/^https?:\/\//i.test(target)) {
        return new Response('bad target', { status: 400 })
      }
      const upstream = await safeFetch(target, {
        headers: {
          Accept: 'image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; Bangumi-For-PC/0.1)'
        }
      })
      if (!upstream.ok) {
        return new Response('upstream error', { status: upstream.status })
      }
      const ct = upstream.headers.get('content-type') || 'image/jpeg'
      const buf = await streamToBuffer(upstream.body)
      const headers = new Headers()
      headers.set('content-type', ct)
      headers.set('cache-control', 'public, max-age=86400')
      headers.set('access-control-allow-origin', '*')
      return new Response(buf, { status: 200, headers })
    } catch (e) {
      console.warn('[imgproxy] 图片代理失败：', requestUrl, e)
      return new Response('proxy error', { status: 502 })
    }
  })
}
