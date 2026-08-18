import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
import { useSettingsStore } from '@/stores/settings'
import { applyUiScale } from '@/scale'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')

// 启动即应用主题与界面缩放偏好（即便未打开设置页），避免仅在某视图加载后才生效
const settings = useSettingsStore(pinia)
settings
  .load()
  .then(() => applyUiScale(settings.uiScale))
  .catch(() => {})
