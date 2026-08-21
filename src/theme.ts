// 主题应用模块：负责把用户偏好（含“跟随系统”）解析为实际 light/dark，
// 并写入 <html data-theme>，同时监听系统配色变化（仅“跟随系统”时实时切换）。
//
// 主题过渡（View Transitions API，圆形揭示）：
// 切换时调用 document.startViewTransition()——浏览器自动截取旧帧、执行 DOM 更新、
// 再截新帧并原子交接，全程无闪烁、无手动截图/解码/滚动锁。
// 动画本身定义在全局样式 ::view-transition-old/new(root) 上：
// 旧帧静止在底层，新帧以「被点击位置为圆心的 clip-path 圆形扩散」揭示出来
// （Material You 风格）；未传点击坐标（如跟随系统触发）时以视口中心为圆心。
// 不支持 VT 或系统开启“减少动态效果”时直接瞬时切换（无害降级）。

export type ThemePref = 'light' | 'dark' | 'system'

const DARK_QUERY = '(prefers-color-scheme: dark)'

let mql: MediaQueryList | null = null
let currentPref: ThemePref = 'dark'
let firstApply = true

function getMql(): MediaQueryList {
  if (!mql) {
    mql = window.matchMedia(DARK_QUERY)
    mql.addEventListener('change', onSystemChange)
  }
  return mql
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

// 应用主题：写入 <html data-theme>，并注册系统监听（幂等）。
// 非首次调用且支持 View Transitions 时播放「圆形揭示」过渡；
// origin 为触发切换的屏幕坐标（如被点击的主题按钮），缺省取视口中心。
// onCovered 在 DOM 更新回调内执行——按钮高亮等 UI 变更与新主题同帧原子生效，
// 浏览器保证旧帧/新帧各自完整，不存在「高亮在旧界面闪现」的中间态。
export async function applyTheme(
  pref: ThemePref,
  onCovered?: () => void,
  origin?: { x: number; y: number }
) {
  const root = document.documentElement
  currentPref = pref
  const isFirst = firstApply
  firstApply = false
  const target = resolve(pref)

  // 持久化“已解析”主题到 localStorage，使刷新时 index.html 内联脚本能在首屏绘制前
  // 同步设好 data-theme，消除浅色主题 Ctrl+R 闪黑。
  try {
    localStorage.setItem('acgn-theme-resolved', target)
  } catch {
    /* 忽略：隐私模式 / 存储不可用 */
  }

  // 同步原生窗口背景色，使缩放窗口时露出的“窗口底色”与内容背景一致（消除黑边/色差层）。
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

  // 目标与当前一致（再次点击同一按钮 / 跟随系统解析结果未变）：无需动画
  if (target === root.dataset.theme) {
    onCovered?.()
    return
  }

  const swap = () => {
    onCovered?.()
    root.dataset.theme = target
    getMql()
  }

  // 降级条件：浏览器不支持 View Transitions，或系统要求减少动态效果 → 瞬时切换
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & {
    startViewTransition?: (updateCallback?: () => void) => unknown
  }
  if (typeof doc.startViewTransition !== 'function' || reduced) {
    swap()
    return
  }

  // 圆心与半径：默认视口中心；有坐标时以该点为圆心，半径=到最远角的距离（保证全屏覆盖）
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? window.innerHeight / 2
  const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)))
  root.style.setProperty('--vt-x', `${Math.round(x)}px`)
  root.style.setProperty('--vt-y', `${Math.round(y)}px`)
  root.style.setProperty('--vt-r', `${r}px`)

  doc.startViewTransition!(swap)
}
