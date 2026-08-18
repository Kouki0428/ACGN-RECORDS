<script setup lang="ts">
import { computed } from 'vue'
import { useEntityCard } from '@/composables/useEntityCard'
import { useEpisodeCommentModal } from '@/composables/useEpisodeCommentModal'

/**
 * Bangumi BBCode 渲染器（安全版）。
 * 支持标签：b / i / u / s / mask / color=xxx / size=N / url[=xxx] / img / quote。
 *   quote：引用他人语句块（Bangumi 评论里「引用别人说的话」格式为
 *          [quote][b]用户名[/b] 说: ...内容...[/quote]，多行），渲染为左侧竖线缩进引用块。
 * 支持 Bangumi 表情包（smiley）：文本中的 (代码) 如 (bgm38)(musume_08)(blake_30)(bgm200)
 *   会被替换为 lain.bgm.tv CDN 的图片（仅白名单前缀，src 恒为 CDN，无 XSS 风险）。
 * 设计要点：自写解析器，只产出白名单标签与属性；文本做 HTML 转义，
 * URL 仅放行 http(s)，color 仅放行 hex/颜色名，size 限幅 8~36；因此 v-html 不引入 XSS。
 */
type BbNode =
  | { t: 'text'; text: string }
  | { t: 'elem'; tag: string; attrs: Record<string, string>; children: BbNode[] }

const props = defineProps<{ text?: string; as?: 'div' | 'span' }>()
const rootTag = computed(() => props.as ?? 'div')

const openRe = /^\[([a-zA-Z]+)(?:=([^\]]*))?\]/
const closeRe = /^\[\/([a-zA-Z]+)\]/

function parseBbcode(src: string): BbNode[] {
  let i = 0
  const parse = (stopTag?: string): BbNode[] => {
    const nodes: BbNode[] = []
    let buf = ''
    while (i < src.length) {
      const ch = src[i]
      if (ch === '[') {
        const rest = src.slice(i)
        const close = closeRe.exec(rest)
        const open = openRe.exec(rest)
        if (close) {
          i += close[0].length
          if (close[1].toLowerCase() === stopTag) {
            if (buf) nodes.push({ t: 'text', text: buf })
            return nodes
          }
          buf += close[0]
          continue
        }
        if (open) {
          const tag = open[1].toLowerCase()
          const attr = open[2]
          i += open[0].length
          if (buf) {
            nodes.push({ t: 'text', text: buf })
            buf = ''
          }
          if (tag === 'img') {
            const end = src.indexOf('[/img]', i)
            const url = end === -1 ? src.slice(i) : src.slice(i, end)
            i = end === -1 ? src.length : end + 6
            nodes.push({ t: 'elem', tag: 'img', attrs: { src: url.trim() }, children: [] })
            continue
          }
          const children = parse(tag)
          const attrs: Record<string, string> = {}
          if (attr != null) {
            if (tag === 'color') attrs.color = attr
            else if (tag === 'size') attrs.size = attr
            else if (tag === 'url') attrs.url = attr
          }
          nodes.push({ t: 'elem', tag, attrs, children })
          continue
        }
      }
      buf += ch
      i++
    }
    if (buf) nodes.push({ t: 'text', text: buf })
    return nodes
  }
  return parse()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
function sanitizeUrl(u: string): string | null {
  const s = (u || '').trim()
  return /^https?:\/\//i.test(s) ? s : null
}
function sanitizeColor(c: string): string | null {
  const s = (c || '').trim()
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(s) ? s : null
}
function sanitizeSize(s: string): number | null {
  const n = parseInt(s, 10)
  if (Number.isNaN(n)) return null
  return Math.min(36, Math.max(8, n))
}
function innerText(n: BbNode): string {
  if (n.t === 'text') return n.text
  return n.children.map(innerText).join('')
}
// —— Bangumi 表情包（smiley）——
// 语法：评论/简介中以 (代码) 表示，如 (bgm38) (musume_08) (blake_30) (bgm200)。
// 实测映射规则（已逐一 curl 验证 URL 可达 206）：
//   (bgmN)  N∈1..10 或 12..22        → bgm/{NN}.png
//           N∈24..125（=tv/01..tv/102）→ tv/{N-23两位}.gif  （如 bgm38 → tv/15.gif，差值恒 23；tv/103+ 起 404，故上限 125）
//           N∈200..238               → tv_vs/bgm_{N}.png    （即“b2xx”系列，200..238 连续存在）
//           N∈{500,501,505,515..519} → tv_500/bgm_{N}.gif   （稀疏特殊系列）
//           N==11 或 23，及其它无图编号 → 不渲染，保留原文
//   (musume_N)                  → musume/musume_{NN}.gif
//   (blake_N)                   → blake/blake_{NN}.gif
// 仅白名单前缀会被转成图片；src 恒为 lain.bgm.tv CDN，故无 XSS 风险。
const SMILEY_BASE = 'https://lain.bgm.tv/img/smiles/'
const SMILEY_RE = /\((?:bgm\d{1,3}|musume_\d{1,3}|blake_\d{1,3})\)/g
// tv_500 系列仅下列编号真实存在（已验证）
const TV_500_CODES = new Set([500, 501, 505, 515, 516, 517, 518, 519])
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function smileyUrl(code: string): string | null {
  const inner = code.slice(1, -1)
  let m = /^bgm(\d+)$/.exec(inner)
  if (m) {
    const n = parseInt(m[1], 10)
    if ((n >= 1 && n <= 10) || (n >= 12 && n <= 22)) return SMILEY_BASE + `bgm/${pad2(n)}.png`
    if (n >= 24 && n <= 125) return SMILEY_BASE + `tv/${pad2(n - 23)}.gif`
    if (n >= 200 && n <= 238) return SMILEY_BASE + `tv_vs/bgm_${n}.png`
    if (TV_500_CODES.has(n)) return SMILEY_BASE + `tv_500/bgm_${n}.gif`
    return null
  }
  m = /^musume_(\d+)$/.exec(inner)
  if (m) return SMILEY_BASE + `musume/musume_${pad2(parseInt(m[1], 10))}.gif`
  m = /^blake_(\d+)$/.exec(inner)
  if (m) return SMILEY_BASE + `blake/blake_${pad2(parseInt(m[1], 10))}.gif`
  return null
}
function renderText(s: string): string {
  let html = escapeHtml(s).replace(/\n/g, '<br>')
  html = html.replace(SMILEY_RE, (full) => {
    const url = smileyUrl(full)
    if (!url) return full
    return `<img class="bb-smiley" src="${escapeAttr(url)}" alt="${escapeAttr(full)}" title="${escapeAttr(full)}" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`
  })
  return html
}

function toHtml(nodes: BbNode[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.t === 'text') {
      out += renderText(n.text)
      continue
    }
    switch (n.tag) {
      case 'b':
        out += `<strong>${toHtml(n.children)}</strong>`
        break
      case 'i':
        out += `<em>${toHtml(n.children)}</em>`
        break
      case 'u':
        out += `<u>${toHtml(n.children)}</u>`
        break
      case 's':
        out += `<s>${toHtml(n.children)}</s>`
        break
      case 'mask':
        out += `<span class="bb-mask">${toHtml(n.children)}</span>`
        break
      case 'color': {
        const c = sanitizeColor(n.attrs.color || '')
        out += c ? `<span style="color:${c}">${toHtml(n.children)}</span>` : toHtml(n.children)
        break
      }
      case 'size': {
        const sz = sanitizeSize(n.attrs.size || '')
        out += sz ? `<span style="font-size:${sz}px">${toHtml(n.children)}</span>` : toHtml(n.children)
        break
      }
      case 'url': {
        const inner = innerText(n)
        const href = sanitizeUrl(n.attrs.url || inner)
        if (!href) {
          out += toHtml(n.children)
          break
        }
        // 站内链接（作品/角色/CV/人物/单集评论）→ 标记，点击拦截并跳应用内悬浮窗
        const link = classifyBgmLink(href)
        if (link) {
          out += `<a class="bb-link bb-link-internal" data-bgm-type="${link.type}" data-bgm-id="${link.id}" href="${escapeAttr(href)}" title="在应用内打开">${toHtml(n.children)}</a>`
        } else {
          out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${toHtml(n.children)}</a>`
        }
        break
      }
      case 'img': {
        const src = sanitizeUrl(n.attrs.src || '')
        if (src) out += `<img src="${escapeAttr(src)}" class="bb-img" loading="lazy" alt="">`
        break
      }
      case 'quote': {
        // 引用他人语句块：[quote][b]用户名[/b] 说: ...内容...[/quote]
        out += `<blockquote class="bb-quote">${toHtml(n.children)}</blockquote>`
        break
      }
      default:
        out += toHtml(n.children)
    }
  }
  return out
}

// —— Bangumi 站内链接拦截 ——
// 评论 / 简介里的 [url=https://bgm.tv/subject|character|person|ep/{id}] 等站内链接，
// 不直接开浏览器，而是唤起对应的应用内悬浮窗（作品卡 / 角色·CV·人物卡 / 单集评论窗）。
// 外部链接仍走浏览器（target=_blank）。
// 命中域名：bgm.tv / bangumi.tv / chii.in / next.bgm.tv（官方域名）以及 bangumi.lol（镜像站）。
const entity = useEntityCard()
const epModal = useEpisodeCommentModal()
type BgmLinkType = 'subject' | 'character' | 'person' | 'episode'
function classifyBgmLink(href: string): { type: BgmLinkType; id: number } | null {
  const m =
    /https?:\/\/(?:bgm\.tv|bangumi\.tv|chii\.in|next\.bgm\.tv|bangumi\.lol)\/(subject|character|person|ep)\/(\d+)/i.exec(
      href || ''
    )
  if (!m) return null
  const kind = m[1].toLowerCase()
  const id = parseInt(m[2], 10)
  if (!Number.isFinite(id) || id <= 0) return null
  if (kind === 'ep') return { type: 'episode', id }
  return { type: kind as BgmLinkType, id }
}
function onClickInternal(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  const a = el?.closest?.('a.bb-link-internal') as HTMLAnchorElement | null
  if (!a) return
  e.preventDefault()
  const type = a.dataset.bgmType as BgmLinkType | undefined
  const id = Number(a.dataset.bgmId)
  if (!type || !Number.isFinite(id)) return
  if (type === 'subject') entity.push('subject', id)
  else if (type === 'character') entity.push('character', id)
  else if (type === 'person') entity.push('person', id)
  else if (type === 'episode') {
    // 站内单集链接：单集评论已并入 EntitySubjectCard 同一 overlay（kind==='episode'），
    // 故先 setData 写入集数据、再 push 到第 4 种 body，悬浮窗容器不重载、仅换内容。
    epModal.setData('', id)
    entity.push('episode', id)
  }
}

const html = computed(() => toHtml(parseBbcode(props.text || '')))
</script>

<template>
  <component :is="rootTag" class="bb" v-html="html" @click="onClickInternal"></component>
</template>

<style>
/* 注意：v-html 注入的内容不受 scoped 影响，故此处用全局样式 */
.bb {
  word-break: break-word;
  overflow-wrap: anywhere;
}
.bb a {
  color: var(--accent-2, #6ea8fe);
  text-decoration: underline;
  cursor: pointer;
}
/* 站内链接（作品/角色/CV/人物/单集评论）虚线提示「在应用内打开」，
   与外部链接（实线、开新标签）区分 */
.bb a.bb-link-internal {
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}
.bb-img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  vertical-align: middle;
  margin: 2px 0;
}
/* 引用他人语句块（[quote]...[/quote]）：左侧竖线 + 缩进 + 浅底，醒目区别于正文。
  灰色底卡（不再用品牌色），两侧加深灰色双引号「" "」包裹引用内容；
  内部文本用 text-dim 偏灰，突出「这是引用」。多行由 renderText 的 <br> 自然换行。 */
.bb-quote {
  display: inline-block;
  max-width: 100%;
  vertical-align: top;
  margin: 5px 0 7px;
  padding: 6px 12px;
  border-left: 3px solid var(--border);
  background: color-mix(in srgb, var(--text-dim) 12%, var(--bg-elev));
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 0.92em;
  line-height: 1.5;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.bb-quote::before {
  content: '\201C';
  color: color-mix(in srgb, var(--text) 45%, var(--text-dim));
  font-weight: 700;
  margin-right: 1px;
}
.bb-quote::after {
  content: '\201D';
  color: color-mix(in srgb, var(--text) 45%, var(--text-dim));
  font-weight: 700;
  margin-left: 1px;
}
.bb-quote strong {
  font-weight: 600;
  color: var(--text);
}
/* Bangumi 表情包（smiley）：行内小图 */
.bb-smiley {
  width: 20px;
  height: 20px;
  display: inline-block;
  vertical-align: text-bottom;
  object-fit: contain;
  margin: 0 1px;
}
/* 马赛克/剧透遮罩：默认遮挡全部内容，悬停显示（与 Bangumi mask 行为一致）。
   遮罩底色用 var(--text)（深模式为浅、浅模式为深），与背景形成对比，
   因此深浅两种主题下都能看清「这里有被遮挡的剧透」。
   文字用 color:transparent 隐藏；内部所有元素（表情 <img>、链接、加粗等）
   用 visibility:hidden 隐藏——这样表情图也不会从黑条后面透出来；
   悬停时整体显出。 */
.bb-mask {
  background: var(--text);
  color: transparent;
  border-radius: 3px;
  cursor: help;
  padding: 0 1px;
  transition: background 0.15s ease, color 0.15s ease;
  user-select: none;
}
.bb-mask * {
  visibility: hidden;
}
.bb-mask:hover {
  background: transparent;
  color: var(--text);
  user-select: auto;
}
.bb-mask:hover * {
  visibility: visible;
}
</style>
