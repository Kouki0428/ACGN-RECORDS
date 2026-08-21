import { defineStore } from 'pinia'
import { ref } from 'vue'
import { dbClient } from '@/services/dbClient'
import { applyTheme, setThemePreset, setSchedule, type ThemePref } from '@/theme'
import { applyAccent } from '@/utils/accent'

export const useSettingsStore = defineStore('settings', () => {
  const autoSync = ref(false)
  // 自动全量拉取从 Bangumi（见 main.ts setupAutoSync，频率已改为每月）
  const autoFullPull = ref(false)
  // 离线数据库（Bangumi Archive）每 30 天自动静默更新开关，默认开启
  const archiveAutoUpdate = ref(true)
  // 自动清理过期缓存开关：每月静默删除半年前未刷新的辅助缓存，默认开启
  const autoCacheClean = ref(true)
  const theme = ref<ThemePref>('dark')
  // GPU 加速开关：默认关闭（与历史行为一致，避免 Windows 缩放重影）。
  // 注意：这是启动期设置，改完后必须重启应用（main.ts 在 app.ready 前据此决定是否
  // 调用 disableHardwareAcceleration）才生效。
  const gpuAcceleration = ref(false)
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
  // 自定义强调色（'' = 默认粉）。写入 :root 的 --accent / --accent-grad，全局派生换色
  const accentColor = ref('')
  // 主题预设皮肤：深 / 浅各自一套（classic=经典）。深色：oled/bangumi/ink；浅色：pure/pink/paper
  const darkPreset = ref('classic')
  const lightPreset = ref('classic')
  // 详情页封面横幅背景（模糊放大的封面作装饰）开关，默认开
  const detailBanner = ref(true)
  // 窗口关闭行为：minimize=点 X 缩到托盘（默认）/ exit=直接退出
  const closeBehavior = ref<'minimize' | 'exit'>('minimize')
  // 定时切换时段：浅色起 ~ 深色起（'HH:mm'，支持跨午夜），theme='scheduled' 时生效
  const scheduleLight = ref('07:00')
  const scheduleDark = ref('19:00')

  async function load() {
    if (initialized) return
    initialized = true
    const rows = await dbClient.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings`
    )
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
      if (r.key === 'accentColor') {
        accentColor.value = r.value
        applyAccent(r.value || null)
      }
      if (r.key === 'darkPreset') {
        darkPreset.value = r.value || 'classic'
        setThemePreset('dark', darkPreset.value)
      }
      if (r.key === 'lightPreset') {
        lightPreset.value = r.value || 'classic'
        setThemePreset('light', lightPreset.value)
      }
      if (r.key === 'detailBanner') detailBanner.value = r.value !== '0'
      if (r.key === 'closeBehavior') {
        closeBehavior.value = r.value === 'exit' ? 'exit' : 'minimize'
        void window.acgn?.app?.setCloseBehavior?.(closeBehavior.value)
      }
      if (r.key === 'scheduleLight') scheduleLight.value = r.value || '07:00'
      if (r.key === 'scheduleDark') scheduleDark.value = r.value || '19:00'
    }
    setSchedule(scheduleLight.value, scheduleDark.value)
    // 若持久化的偏好是「定时」，需在时段载入后重新解析一次（循环内的首次 applyTheme
    // 发生在 setSchedule 之前，用的是默认时段）
    if (theme.value === 'scheduled') void applyTheme('scheduled')
  }

  async function set(key: string, value: string) {
    await dbClient.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
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
  }

  // 仅在遮罩已盖住屏幕时调用：更新按钮高亮（不写库、不触发 applyTheme），
  // 确保高亮切换发生在用户不可见的过渡期
  function commitTheme(v: ThemePref) {
    theme.value = v
  }

  return { autoSync, autoFullPull, archiveAutoUpdate, autoCacheClean, theme, gpuAcceleration, uiScale, gridAnimEnabled, gridAnimSpeed, tmdbKey, vndbToken, proxy, accentColor, darkPreset, lightPreset, detailBanner, closeBehavior, scheduleLight, scheduleDark, load, set, commitTheme }
})
