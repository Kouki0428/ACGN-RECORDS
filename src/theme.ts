// 主题应用模块：负责把用户偏好（含“跟随系统”）解析为实际 light/dark，
// 并写入 <html data-theme>，同时监听系统配色变化（仅“跟随系统”时实时切换）。
//
// 主题过渡（刷新式扫掠擦除）：切换前先用主进程 webContents.capturePage 截取
// **当前窗口的完整画面（旧主题真实外观，含背景/卡片/边栏/文字）——即“被替换
// 的主体”**。关键点：旧画面**固定不动**，只让一条 CSS mask 的透明区从左往右扫入，
// 逐步擦除旧画面、露出其下已切好的新主题（无论黑→白还是白→黑，统一从左往右）。
// 做法：把 mask 渐变设得比视口更宽，起点让“黑区”盖满整屏（旧画面全可见），终点
// 让“透明区”盖满整屏（新主题全露出），动画只改 mask-position，旧画面本身绝不发生位移。
//
// 防闪烁要点：遮罩用真正的 <img> 承载截图（而非 div+background-image），并在显示前
// 调用 img.decode() 确保纹理就绪——否则 background-image 首帧纹理未解码会是透明的，
// 而那一帧新主题已切到 DOM，会透过透明遮罩闪现一帧（正是“按钮闪一下”的根因）。
// 截图失败时回退为旧主题背景渐变（--bg-grad，同步渲染，不闪）。

export type ThemePref = 'light' | 'dark' | 'system'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const SWEEP_MS = 720
const SOFT_RATIO = 0.5 // 柔化前沿宽度占视口比例（仅作擦除边界的柔化，不移动画面）

let mql: MediaQueryList | null = null
let currentPref: ThemePref = 'dark'
let firstApply = true
let sweepTimer: number | null = null

function getMql(): MediaQueryList {
  if (!mql) {
    mql = window.matchMedia(DARK_QUERY)
    mql.addEventListener('change', onSystemChange)
  }
  return mql
}

// 主题擦除过渡期间锁定页面滚动：遮罩 <img> 是 position:fixed（钉在视口），
// 若动画进行中页面被滚动，实时内容（新主题）跟着滚走而固定快照不动 → 错位。
// 用 preventDefault 阻止滚动“动作”（而非 overflow:hidden），滚动条保留、无布局跳动，
// 快照与实时内容始终锁定在同一位置。动画结束（清理定时器）即解锁。
let scrollLockActive = false
function preventScroll(e: Event) {
  e.preventDefault()
}
const SCROLL_KEYS = new Set([
  ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
])
function preventKeyScroll(e: KeyboardEvent) {
  if (SCROLL_KEYS.has(e.key)) e.preventDefault()
}
function lockScroll() {
  if (scrollLockActive) return
  window.addEventListener('wheel', preventScroll, { passive: false })
  window.addEventListener('touchmove', preventScroll, { passive: false })
  window.addEventListener('keydown', preventKeyScroll, { passive: false })
  scrollLockActive = true
}
function unlockScroll() {
  if (!scrollLockActive) return
  window.removeEventListener('wheel', preventScroll)
  window.removeEventListener('touchmove', preventScroll)
  window.removeEventListener('keydown', preventKeyScroll)
  scrollLockActive = false
}

// 系统配色变化时，仅当用户选了“跟随系统”才更新
function onSystemChange() {
  if (currentPref === 'system') {
    void applyTheme(currentPref)
  }
}

// 把偏好解析为实际生效的主题
export function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return getMql().matches ? 'dark' : 'light'
  return pref
}

// 懒创建扫掠遮罩：用 <img> 承载旧画面截图（decode 后纹理就绪才显示，不闪）。
// 挂在 <html> 上，不依赖 body 是否已就绪；pointer-events:none 不拦截点击。
function getWipe(): HTMLImageElement {
  let el = document.getElementById('theme-wipe') as HTMLImageElement | null
  if (!el) {
    el = document.createElement('img')
    el.id = 'theme-wipe'
    el.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:9999;pointer-events:none;display:none;object-fit:cover;' +
      'will-change:mask-position;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;'
    document.documentElement.appendChild(el)
  }
  return el
}

// 应用主题：写入 <html data-theme>，并注册系统监听（幂等）。
// 非首次调用时先截取旧画面、再执行“新主题擦除刷出”的扫掠过渡动画。
// onCovered 在“遮罩已盖住整屏”之后被调用——用于把按钮高亮切换到新按钮，
// 由于此时整屏已被遮罩遮挡，用户看不到高亮在旧主题界面闪现的那一帧。
export async function applyTheme(pref: ThemePref, onCovered?: () => void) {
  const root = document.documentElement
  // 切换前先抓取“当前（旧）”主题背景：优先用真实径向渐变 --bg-grad，
  // 取不到再回退 --bg 纯色，作为遮罩基底（截图不可用时保证不闪）。
  const styles = getComputedStyle(root)
  const oldBg = styles.getPropertyValue('--bg').trim() || '#14171c'
  const oldGrad = styles.getPropertyValue('--bg-grad').trim() || oldBg

  currentPref = pref
  const isFirst = firstApply
  firstApply = false
  const target = resolve(pref)

  // 持久化“已解析”主题到 localStorage，使刷新时 index.html 内联脚本能在首屏绘制前
  // 同步设好 data-theme，消除浅色主题 Ctrl+R 闪黑（默认 :root 为深色，data-theme 原
  // 要到异步读库后才挂）。覆盖启动 load / 手动切换 / 系统配色变化三处。
  try {
    localStorage.setItem('acgn-theme-resolved', target)
  } catch {
    /* 忽略：隐私模式 / 存储不可用 */
  }

  // 同步原生窗口背景色，使缩放窗口时露出的“窗口底色”与内容背景一致（消除黑边/色差层）。
  // 暗色梯度底色为 #14171c（--bg，覆盖窗口绝大部分），亮色为 #f3f5f9（--bg）。
  // 失败（非 Electron 环境）静默忽略。
  try {
    void window.acgn?.theme?.setNativeBg?.(target === 'light' ? '#f3f5f9' : '#14171c')
  } catch {
    /* 忽略：非 Electron / 桥未就绪 */
  }

  // 首次加载：直接应用，不播过渡（避免启动闪一下）
  if (isFirst) {
    root.dataset.theme = target
    getMql()
    return
  }

  // 目标主题与当前已应用的主题一致（如浅色模式下再次点击“浅色”按钮，
  // 或“跟随系统”解析后仍是当前主题）：无需重播擦除动画，直接返回。
  // 当前高亮的按钮仍是同一个，因此也没有视觉跳变。
  if (target === root.dataset.theme) {
    onCovered?.()
    return
  }

  // 过渡期间锁定滚动，避免 fixed 遮罩快照与实时滚动内容错位
  lockScroll()

  // 1) 先截旧画面（此时 DOM 仍是旧主题，因为还没设 data-theme）
  let snap: string | null = null
  try {
    snap = (await window.acgn?.theme?.capture?.()) ?? null
  } catch {
    snap = null
  }

  const wipe = getWipe()
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer)
    sweepTimer = null
  }

  // 2) 准备遮罩内容。优先用旧画面截图；用 <img>.decode() 在显示前确保纹理就绪，
  //    彻底消除“背景图首帧未解码→遮罩透明→新主题闪现”的闪烁。
  //    无截图（非 Electron / 解码失败）则回退旧主题背景渐变（同步渲染，不闪）。
  if (snap) {
    wipe.style.backgroundImage = 'none'
    wipe.removeAttribute('src')
    wipe.src = snap
    try {
      await wipe.decode()
    } catch {
      snap = null
    }
  }
  if (snap) {
    wipe.style.display = ''
  } else {
    wipe.removeAttribute('src')
    wipe.style.backgroundImage = oldGrad
    wipe.style.display = ''
  }
  wipe.style.backgroundColor = 'transparent'
  void wipe.offsetWidth // 强制提交“盖住”这一帧，保证下一帧切主题时已被遮罩覆盖

  // 2.5) 遮罩已盖住整屏：此刻切换按钮高亮（settings.theme）被遮罩完全遮挡，
  //      用户看不到高亮在“旧主题界面”闪现的那一帧（避免按钮高亮位置跳变造成的闪）
  onCovered?.()

  // 3) 盖住之后再切新主题（藏在遮罩之下，绝不闪）
  root.dataset.theme = target
  getMql()

  // mask：固定不动的旧画面 + 一道从左往右扫开的“擦除”边界。
  // 渐变布局：左侧 vw 透明（露出新主题）→ 接着 soft 宽的柔和过渡 → 右侧黑（盖住旧画面）。
  // mask 比视口更宽（2vw+soft）：起点让“黑区”覆盖整屏（旧画面全可见，不漏新主题），
  // 终点让“透明区”覆盖整屏（新主题全露出）。整个过程只动 mask-position，旧画面纹丝不动。
  const vw = window.innerWidth
  const soft = Math.round(vw * SOFT_RATIO)
  const T = vw * 2 + soft
  // mask 渐变用多段中点近似 smoothstep（缓入缓出），使擦除边界更柔（非纯线性硬过渡）
  const s1 = vw + Math.round(soft * 0.25)
  const s2 = vw + Math.round(soft * 0.5)
  const s3 = vw + Math.round(soft * 0.75)
  const maskGrad =
    `linear-gradient(90deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${vw}px, ` +
    `rgba(0,0,0,0.2) ${s1}px, rgba(0,0,0,0.5) ${s2}px, ` +
    `rgba(0,0,0,0.8) ${s3}px, #000 ${vw + soft}px, #000 ${T}px)`
  wipe.style.webkitMaskImage = maskGrad
  wipe.style.maskImage = maskGrad
  wipe.style.webkitMaskSize = `${T}px 100%`
  wipe.style.maskSize = `${T}px 100%`

  // 起点：把“黑区”对齐到视口（旧画面全可见）；终点：把“透明区”对齐到视口（新主题全露出）
  const startX = -(vw + soft)
  wipe.style.transition = 'none'
  wipe.style.webkitMaskPosition = `${startX}px 0`
  wipe.style.maskPosition = `${startX}px 0`
  void wipe.offsetWidth // 强制提交起点
  wipe.style.transition =
    `mask-position ${SWEEP_MS}ms cubic-bezier(0.65, 0, 0.35, 1), ` +
    `-webkit-mask-position ${SWEEP_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
  wipe.style.webkitMaskPosition = '0px 0'
  wipe.style.maskPosition = '0px 0'

  // 扫完后隐藏并清理，避免残留；同时解锁滚动
  sweepTimer = window.setTimeout(() => {
    wipe.style.display = 'none'
    wipe.removeAttribute('src')
    wipe.style.backgroundImage = ''
    sweepTimer = null
    unlockScroll()
  }, SWEEP_MS + 80)
}
