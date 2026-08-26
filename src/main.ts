import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
import { useSettingsStore } from '@/stores/settings'
import { applyUiScale, applyCardScale } from '@/scale'
import { installCrashGuard } from './crashGuard'

const pinia = createPinia()
const app = createApp(App).use(pinia).use(router)

// 崩溃兜底：挂载失败 → 原生恢复页；运行期异常 → Toast 节流提示
installCrashGuard(() => app.mount('#app'), app)

// 启动即应用主题与界面缩放偏好（即便未打开设置页），避免仅在某视图加载后才生效
const settings = useSettingsStore(pinia)
settings
  .load()
  .then(() => {
    applyUiScale(settings.uiScale)
    applyCardScale(settings.cardScale)
  })
  .catch(() => {})
