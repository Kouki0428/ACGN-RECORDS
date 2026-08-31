import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dbClient } from '@/services/dbClient'
import { applyTheme, setThemePreset, setSchedule, type ThemePref } from '@/theme'
import { applyAccent, applyAux } from '@/utils/accent'
import { applyCardScale } from '@/scale'

export const useSettingsStore = defineStore('settings', () => {
  const autoSync = ref(false)
  // 自动全量拉取从 Bangumi（见 main.ts setupAutoSync，频率已改为每月）
  const autoFullPull = ref(false)
  // 离线数据库（Bangumi Archive）每 30 天自动静默更新开关，默认开启
  const archiveAutoUpdate = ref(true)
  // 自动清理过期缓存开关：每月静默删除半年前未刷新的辅助缓存，默认开启
  const autoCacheClean = ref(true)
  const theme = ref<ThemePref>('dark')
  // GPU 加速开关：默认开启（2026-08-27 用户要求：多卡片 FLIP 动画在纯软件渲染下卡顿，
  // 开 GPU 让合成走显卡）。代价是 Windows 缩放窗口的重影会回来（此前默认关闭即为去重影）。
  // 注意：这是启动期设置，改完后必须重启应用（main.ts 在 app.ready 前据此决定是否
  // 调用 disableHardwareAcceleration）才生效。
  const gpuAcceleration = ref(true)
  // 界面缩放系数（浏览器式 zoom，1 = 100%）。作用于整个渲染窗口，实时生效、无需重启。
  // 默认 1；持久化到 settings 表 uiScale 键，启动入口（src/main.ts）按其重新应用。
  const uiScale = ref(1)
  // 卡片重排动画（窗口缩放/侧栏收起导致列数变化时）：总开关 + 速度。
  // 速度滑条语义：0 = 最快（左），1 = 最慢（右），默认 0.2（偏快）。
  // 该 0~1 值经 useGridResizeFlip.getK() 反相映射到追向比例 K（0=快→K≈0.55，1=慢→K≈0.12）。
  const gridAnimEnabled = ref(true)
  const gridAnimSpeed = ref(0.2)
  // 是否已初始化：主题仅在首次（应用启动）应用一次，之后进入设置页不再重播切换动画
  let initialized = false

  // 数据源配置（仅本机存储）
  const tmdbKey = ref('')
  const vndbToken = ref('')
  // 手动代理（用于 api.bgm.tv 直连超时的网络环境，如 Clash/v2ray 地址）
  const proxy = ref('')
  // —— 强调/辅助色：深、浅各存一套（accentColorDark/Light、auxColorDark/Light）——
  // 旧版单键 accentColor / auxColor 读取时兼容迁移到两套；切换主题时自动应用当前模式那套。
  const accentDark = ref('')
  const accentLight = ref('')
  const auxDark = ref('')
  const auxLight = ref('')
  // 当前主题模式（由 <html data-theme> 实时同步，随深/浅切换变化）
  const mode = ref<'light' | 'dark'>(
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )
  // 暴露给 UI 的「当前模式」强调色/辅助色（读写均落到当前模式那套），保持旧字段名兼容
  const accentColor = computed({
    get: () => (mode.value === 'light' ? accentLight.value : accentDark.value),
    set: (v: string) => {
      if (mode.value === 'light') accentLight.value = v
      else accentDark.value = v
    }
  })
  const auxColor = computed({
    get: () => (mode.value === 'light' ? auxLight.value : auxDark.value),
    set: (v: string) => {
      if (mode.value === 'light') auxLight.value = v
      else auxDark.value = v
    }
  })
  // 应用当前模式的强调/辅助色到 :root（自定义色覆盖预设，空则恢复预设/默认）。
  // 直接读 <html data-theme>，避免依赖微任务时序的 mode 缓存。
  function applyModeColors() {
    const m = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    mode.value = m
    applyAccent((m === 'light' ? accentLight : accentDark).value || null)
    applyAux((m === 'light' ? auxLight : auxDark).value || null)
  }
  // 监听 data-theme 变化（applyTheme 同步写入）：深/浅切换时自动应用对应那套颜色
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(applyModeColors)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  // 主题预设皮肤：深 / 浅各自一套（classic=经典）。深色：oled/bangumi/ink；浅色：pure/pink/paper
  const darkPreset = ref('classic')
  const lightPreset = ref('classic')
  // 详情页封面横幅背景（模糊放大的封面作装饰）开关，默认开（仅作品详情页）
  const detailBanner = ref(true)
  // 人物横幅背景（角色/CV 详情卡模糊放大的立绘作装饰）开关，默认开（与作品横幅分开控制）
  const characterBanner = ref(true)
  // 沉浸光感（液态玻璃）：详情页快捷跳转按钮的玻璃质感与鼠标跟随光斑，默认开
  const immersiveGlow = ref(true)
  // 沉浸光感强度档位：极弱 faintest / 微弱 faint / 弱 weak / 默认 default / 强 strong / 特强 strongest / 超强 ultra
  const immersiveGlowStrength = ref<'faintest' | 'faint' | 'weak' | 'default' | 'strong' | 'strongest' | 'ultra'>('default')
  // 快捷跳转栏：详情页与作品悬浮窗顶部的锚点导航，默认开
  const anchorBarEnabled = ref(true)
  // 主页卡片大小缩放（0.75~1.5，1=标准 360px 最小列宽），实时生效
  const cardScale = ref(1)
  // 作品栏区块显示开关（详情页与悬浮窗共用），默认全开
  const showCharacters = ref(true)
  const showVolumes = ref(true)      // 单行本（书籍类的卷册关联）
  const showRelations = ref(true)    // 关联条目
  const showTopics = ref(true)       // 讨论版
  const showTucao = ref(true)        // 吐槽箱
  const showGallery = ref(true)      // 游戏画廊
  const showPurchase = ref(true)     // 购买信息
  // 窗口关闭行为：默认 exit=点 X 直接退出；勾选后 minimize=缩到托盘。首次点 X 时主进程会弹窗询问一次
  const closeBehavior = ref<'minimize' | 'exit'>('exit')
  // 定时切换时段：浅色起 ~ 深色起（'HH:mm'，支持跨午夜），theme='scheduled' 时生效
  const scheduleLight = ref('07:00')
  const scheduleDark = ref('19:00')
  // 圆角档位（仅本机存储）：无 / 微 / 小 / 默认 / 大 / 特大；写入 <html data-radius>，
  // 由 main.css 覆盖全局 --radius / --radius-sm。默认 默认（=基线，不加属性也行）
  const cornerRadius = ref<'none' | 'tiny' | 'small' | 'default' | 'large' | 'xlarge'>('default')
  // 界面操作音效总开关（如开关切换的咔嗒声），默认关闭
  const uiSound = ref(false)
  // 游戏画廊 R18 截图显示开关（全局记忆，非单条目），默认隐藏 R18
  const galleryR18 = ref(false)
  // 显示 NSFW（R18）作品封面：开=正常显示封面，关=封面模糊（默认关=模糊）
  const showNsfw = ref(false)

  async function load() {
    if (initialized) return
    initialized = true
    const rows = await dbClient.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings`
    )
    // 旧版单键强调/辅助色的迁移源（在循环中捕获，循环后回填到深浅两套）
    let legacyAccent: string | null = null
    let legacyAux: string | null = null
    for (const r of rows) {
      if (r.key === 'autoSync') autoSync.value = r.value === '1'
      if (r.key === 'autoFullPull') autoFullPull.value = r.value === '1'
      if (r.key === 'archiveAutoUpdate') archiveAutoUpdate.value = r.value !== '0'
      if (r.key === 'autoCacheClean') autoCacheClean.value = r.value !== '0'
      if (r.key === 'theme') {
        theme.value = r.value as ThemePref
        void applyTheme(theme.value)
      }
      if (r.key === 'gpuAcceleration') gpuAcceleration.value = r.value === '1'
      if (r.key === 'uiScale') uiScale.value = parseFloat(r.value) || 1
      if (r.key === 'gridAnimEnabled') gridAnimEnabled.value = r.value !== '0'
      if (r.key === 'gridAnimSpeed') {
        const v = parseFloat(r.value)
        // 兼容旧版 0~100 量纲（旧值越大越快）：反相映射到新 0~1（0=快）。
        gridAnimSpeed.value = isFinite(v)
          ? v > 1
            ? Math.min(1, Math.max(0, 1 - v / 100))
            : v
          : 0.2
      }
      if (r.key === 'tmdb_api_key') tmdbKey.value = r.value
      if (r.key === 'vndb_token') vndbToken.value = r.value
      if (r.key === 'proxy') proxy.value = r.value
      if (r.key === 'accentColorDark') accentDark.value = r.value
      if (r.key === 'accentColorLight') accentLight.value = r.value
      if (r.key === 'auxColorDark') auxDark.value = r.value
      if (r.key === 'auxColorLight') auxLight.value = r.value
      // 旧版单键：仅作为迁移源，稍后在对应新版键缺失时回填
      if (r.key === 'accentColor') legacyAccent = r.value
      if (r.key === 'auxColor') legacyAux = r.value
      if (r.key === 'darkPreset') {
        darkPreset.value = r.value || 'classic'
        setThemePreset('dark', darkPreset.value)
      }
      if (r.key === 'lightPreset') {
        lightPreset.value = r.value || 'classic'
        setThemePreset('light', lightPreset.value)
      }
      if (r.key === 'detailBanner') detailBanner.value = r.value !== '0'
      if (r.key === 'characterBanner') characterBanner.value = r.value !== '0'
      if (r.key === 'immersiveGlow') immersiveGlow.value = r.value !== '0'
      if (r.key === 'immersiveGlowStrength') {
        immersiveGlowStrength.value = (r.value as 'faintest' | 'faint' | 'weak' | 'default' | 'strong' | 'strongest' | 'ultra') || 'default'
        document.documentElement.dataset.glowStrength = immersiveGlowStrength.value
      }
      if (r.key === 'anchorBarEnabled') anchorBarEnabled.value = r.value !== '0'
      if (r.key === 'cardScale') {
        const v = parseFloat(r.value)
        cardScale.value = isFinite(v) && v >= 0.6 && v <= 1.8 ? v : 1
      }
      if (r.key === 'showCharacters') showCharacters.value = r.value !== '0'
      if (r.key === 'showVolumes') showVolumes.value = r.value !== '0'
      if (r.key === 'showRelations') showRelations.value = r.value !== '0'
      if (r.key === 'showTopics') showTopics.value = r.value !== '0'
      if (r.key === 'showTucao') showTucao.value = r.value !== '0'
      if (r.key === 'showGallery') showGallery.value = r.value !== '0'
      if (r.key === 'showPurchase') showPurchase.value = r.value !== '0'
      if (r.key === 'closeBehavior') {
        closeBehavior.value = r.value === 'exit' ? 'exit' : 'minimize'
        void window.acgn?.app?.setCloseBehavior?.(closeBehavior.value)
      }
      if (r.key === 'scheduleLight') scheduleLight.value = r.value || '07:00'
      if (r.key === 'scheduleDark') scheduleDark.value = r.value || '19:00'
      if (r.key === 'cornerRadius') {
        cornerRadius.value = (r.value as 'none' | 'tiny' | 'small' | 'default' | 'large' | 'xlarge') || 'default'
        document.documentElement.dataset.radius = cornerRadius.value
      }
      if (r.key === 'uiSound') uiSound.value = r.value !== '0'
      if (r.key === 'galleryR18') galleryR18.value = r.value === '1'
      if (r.key === 'showNsfw') showNsfw.value = r.value === '1'
    }
    setSchedule(scheduleLight.value, scheduleDark.value)
    // 若持久化的偏好是「定时」，需在时段载入后重新解析一次（循环内的首次 applyTheme
    // 发生在 setSchedule 之前，用的是默认时段）
    if (theme.value === 'scheduled') void applyTheme('scheduled')
    // 把卡片大小写入 :root，供全局 .card / 主页 .hcard 等比缩放
    applyCardScale(cardScale.value)
    // 旧版单键迁移：新版对应键缺失时，把旧单键颜色回填到深浅两套（已有新版键则保留）
    if (legacyAccent !== null) {
      if (accentDark.value === '') accentDark.value = legacyAccent
      if (accentLight.value === '') accentLight.value = legacyAccent
    }
    if (legacyAux !== null) {
      if (auxDark.value === '') auxDark.value = legacyAux
      if (auxLight.value === '') auxLight.value = legacyAux
    }
    // 应用当前模式的强调/辅助色到 :root（数据主题已由上方 applyTheme 解析确定）
    applyModeColors()
  }

  async function set(key: string, value: string) {
    // 强调/辅助色：按当前模式路由到深浅各自的存储键，保证深浅独立记忆
    let storeKey = key
    if (key === 'accentColor') storeKey = mode.value === 'light' ? 'accentColorLight' : 'accentColorDark'
    if (key === 'auxColor') storeKey = mode.value === 'light' ? 'auxColorLight' : 'auxColorDark'
    await dbClient.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [storeKey, value]
    )
    if (key === 'autoSync') autoSync.value = value === '1'
    if (key === 'autoFullPull') autoFullPull.value = value === '1'
    if (key === 'archiveAutoUpdate') archiveAutoUpdate.value = value === '1'
    if (key === 'autoCacheClean') autoCacheClean.value = value === '1'
    if (key === 'theme') {
      // 仅持久化到库；按钮高亮的实际切换延迟到遮罩盖住屏幕之后（见 commitTheme
      // + applyTheme 的 onCovered 回调），避免在旧主题界面闪现一帧高亮跳变
    }
    if (key === 'gpuAcceleration') gpuAcceleration.value = value === '1'
      if (key === 'uiScale') uiScale.value = parseFloat(value) || 1
      if (key === 'gridAnimEnabled') gridAnimEnabled.value = value !== '0'
      if (key === 'gridAnimSpeed') {
        const v = parseFloat(value)
        gridAnimSpeed.value = isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.2
      }
      if (key === 'tmdb_api_key') tmdbKey.value = value
    if (key === 'vndb_token') vndbToken.value = value
    if (key === 'proxy') proxy.value = value
    if (key === 'accentColor') {
      accentColor.value = value
      applyAccent(value || null)
    }
    if (key === 'auxColor') {
      auxColor.value = value
      applyAux(value || null)
    }
    if (key === 'darkPreset') {
      darkPreset.value = value || 'classic'
      setThemePreset('dark', darkPreset.value)
      // 预设变化需刷新 data-preset 属性与原生底色（同主题早退分支也会同步，这里显式触发一次）
      void applyTheme(theme.value)
    }
    if (key === 'lightPreset') {
      lightPreset.value = value || 'classic'
      setThemePreset('light', lightPreset.value)
      void applyTheme(theme.value)
    }
    if (key === 'detailBanner') detailBanner.value = value !== '0'
    if (key === 'characterBanner') characterBanner.value = value !== '0'
    if (key === 'immersiveGlow') immersiveGlow.value = value !== '0'
    if (key === 'immersiveGlowStrength') {
      immersiveGlowStrength.value = (value as 'faintest' | 'faint' | 'weak' | 'default' | 'strong' | 'strongest' | 'ultra') || 'default'
      document.documentElement.dataset.glowStrength = immersiveGlowStrength.value
    }
    if (key === 'anchorBarEnabled') anchorBarEnabled.value = value !== '0'
    if (key === 'cardScale') {
      const v = parseFloat(value)
      cardScale.value = isFinite(v) && v >= 0.6 && v <= 1.8 ? v : 1
      applyCardScale(cardScale.value)
    }
    if (key === 'showCharacters') showCharacters.value = value !== '0'
    if (key === 'showVolumes') showVolumes.value = value !== '0'
    if (key === 'showRelations') showRelations.value = value !== '0'
    if (key === 'showTopics') showTopics.value = value !== '0'
    if (key === 'showTucao') showTucao.value = value !== '0'
    if (key === 'showGallery') showGallery.value = value !== '0'
    if (key === 'showPurchase') showPurchase.value = value !== '0'
    if (key === 'closeBehavior') {
      closeBehavior.value = value === 'exit' ? 'exit' : 'minimize'
      void window.acgn?.app?.setCloseBehavior?.(closeBehavior.value)
    }
    if (key === 'scheduleLight' || key === 'scheduleDark') {
      if (key === 'scheduleLight') scheduleLight.value = value || '07:00'
      else scheduleDark.value = value || '19:00'
      setSchedule(scheduleLight.value, scheduleDark.value)
      if (theme.value === 'scheduled') void applyTheme('scheduled')
    }
    if (key === 'cornerRadius') {
      cornerRadius.value = (value as 'none' | 'tiny' | 'small' | 'default' | 'large' | 'xlarge') || 'default'
      document.documentElement.dataset.radius = cornerRadius.value
    }
    if (key === 'uiSound') uiSound.value = value !== '0'
    if (key === 'galleryR18') galleryR18.value = value === '1'
    if (key === 'showNsfw') showNsfw.value = value === '1'
  }

  // 仅在遮罩已盖住屏幕时调用：更新按钮高亮（不写库、不触发 applyTheme），
  // 确保高亮切换发生在用户不可见的过渡期
  function commitTheme(v: ThemePref) {
    theme.value = v
  }

  return { autoSync, autoFullPull, archiveAutoUpdate, autoCacheClean, theme, mode, gpuAcceleration, uiScale, gridAnimEnabled, gridAnimSpeed, tmdbKey, vndbToken, proxy, accentColor, auxColor, darkPreset, lightPreset, detailBanner, characterBanner, immersiveGlow, anchorBarEnabled, cardScale, showCharacters, showVolumes, showRelations, showTopics, showTucao, showGallery, showPurchase, closeBehavior, scheduleLight, scheduleDark, cornerRadius, uiSound, galleryR18, showNsfw, immersiveGlowStrength, load, set, commitTheme }
})
