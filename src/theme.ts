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

export type ThemePref = 'light' | 'dark' | 'system' | 'scheduled'

const DARK_QUERY = '(prefers-color-scheme: dark)'

let mql: MediaQueryList | null = null
let currentPref: ThemePref = 'dark'
let firstApply = true

// —— 主题预设皮肤：深 / 浅各自一套（classic=经典不写属性，走样式表默认）——
// 深色：oled 纯黑 / bangumi 粉夜 / ink 墨绿夜；浅色：pure 纯白 / pink 粉白 / paper 墨绿纸
const presets: Record<'dark' | 'light', string> = { dark: 'classic', light: 'classic' }
export function setThemePreset(mode: 'dark' | 'light', p: string) {
  presets[mode] = p || 'classic'
}

// 原生窗口底色：必须与各主题/预设的 --bg 完全一致，缩放时内容未重绘而露出的「底色缝」
// 才会与内容右缘同色、不可见。改动 src/assets/main.css 中 --bg 时需同步此处。
const NATIVE_BG: Record<string, string> = {
  'dark:classic': '#14171c',
  'dark:oled': '#000000',
  'dark:pink': '#1a1216',
  'dark:ink': '#0e1411',
  'dark:mint': '#0c1715',
  'dark:galaxy': '#0e0d1a',
  'dark:sunset': '#1a1110',
  'dark:neon': '#0d0a14',
  'light:classic': '#f3f5f9',
  'light:pure': '#ffffff',
  'light:pink': '#fbf1f4',
  'light:paper': '#f1f5ef',
  'light:mint': '#eef6f3',
  'light:galaxy': '#f1eefb',
  'light:sunset': '#fdf1ea',
  'light:neon': '#fbeefb',
  'dark:ocean': '#0a1420',
  'dark:rose': '#1a0e14',
  'dark:forest': '#0c1510',
  'dark:amber': '#1a1408',
  'light:ocean': '#eaf2fb',
  'light:rose': '#fdeef2',
  'light:forest': '#eef6ee',
  'light:amber': '#fdf6e9',
  'dark:indigo': '#0a0e1a',
  'dark:lava': '#1a0a0a',
  'dark:moss': '#14130a',
  'light:indigo': '#eaeefb',
  'light:lava': '#fbf0ea',
  'light:moss': '#f3f5ea'
}

// —— 定时切换时段（'HH:mm'，浅色起 ~ 深色起；支持跨午夜）——
let schedLight = '07:00'
let schedDark = '19:00'
export function setSchedule(light: string, dark: string) {
  if (/^\d{2}:\d{2}$/.test(light)) schedLight = light
  if (/^\d{2}:\d{2}$/.test(dark)) schedDark = dark
}

function nowHM(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// 定时模式的滚动 ticker：每 30s 重解析一次（同值时 applyTheme 早退，无副作用）
let schedTimer: number | null = null
function ensureScheduleTicker() {
  if (schedTimer !== null) return
  schedTimer = window.setInterval(() => {
    if (currentPref === 'scheduled') void applyTheme('scheduled')
  }, 30000)
}

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
  if (pref === 'scheduled') {
    // 浅色时段 [schedLight, schedDark)，支持跨午夜（如 22:00~07:00 的反向区间）
    const now = nowHM()
    const inLight =
      schedLight <= schedDark
        ? now >= schedLight && now < schedDark
        : now >= schedLight || now < schedDark
    return inLight ? 'light' : 'dark'
  }
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
  if (pref === 'scheduled') ensureScheduleTicker()
  const target = resolve(pref)

  // 预设皮肤：按解析后的主题取对应（深/浅各一套）；classic 不写属性，走样式表默认。
  // 主题实际切换（light↔dark）时 data-preset 必须与 data-theme 在 swap 内原子生效：
  // 若提前写入，旧帧（如浅色）会已带上新预设（如深色 oled）而提前变暗，揭示动画失真。
  // 仅「预设变了但主题值未变」时立即刷新（同值早退分支仍要走皮肤属性更新）。
  const pv = presets[target]
  const presetAttr = pv !== 'classic' ? pv : ''
  const themeChanging = !isFirst && target !== root.dataset.theme
  if (!themeChanging) {
    if (presetAttr) root.dataset.preset = presetAttr
    else delete root.dataset.preset
  }
  try {
    localStorage.setItem('acgn-preset-resolved', presetAttr)
  } catch {
    /* ignore */
  }

  // 持久化“已解析”主题到 localStorage，使刷新时 index.html 内联脚本能在首屏绘制前
  // 同步设好 data-theme，消除浅色主题 Ctrl+R 闪黑。
  try {
    localStorage.setItem('acgn-theme-resolved', target)
  } catch {
    /* 忽略：隐私模式 / 存储不可用 */
  }

  // 同步原生窗口背景色：用确定性的主题→底色映射（避开 getComputedStyle 时序问题），
  // 保证与内容右缘 --bg 完全一致，缩放时露出的底色缝不可见。
  const syncNativeBg = () => {
    try {
      const key = `${target}:${presetAttr || 'classic'}`
      const bg = NATIVE_BG[key] || (target === 'light' ? '#f3f5f9' : '#14171c')
      void window.acgn?.theme?.setNativeBg?.(bg)
    } catch {
      /* 忽略 */
    }
  }

  // 首次加载：直接应用，不播过渡（避免启动闪一下）
  if (isFirst) {
    root.dataset.theme = target
    getMql()
    syncNativeBg()
    return
  }

  // 目标与当前一致（再次点击同一按钮 / 跟随系统解析结果未变）：无需动画
  // （预设属性已在上方刷新；原生底色也同步一次以跟随预设变化）
  if (target === root.dataset.theme) {
    onCovered?.()
    syncNativeBg()
    return
  }

  const swap = () => {
    onCovered?.()
    // 与 data-theme 同帧原子切换预设，保证旧帧保持旧预设、新帧才是新预设
    if (presetAttr) root.dataset.preset = presetAttr
    else delete root.dataset.preset
    root.dataset.theme = target
    getMql()
    syncNativeBg()
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
