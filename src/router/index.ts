import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import AnimeView from '../views/AnimeView.vue'
import LightNovelView from '../views/LightNovelView.vue'
import MangaView from '../views/MangaView.vue'
import GalgameView from '../views/GalgameView.vue'
import PersonalView from '../views/PersonalView.vue'
import SettingsView from '../views/SettingsView.vue'
import SearchView from '../views/SearchView.vue'

const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '��ҳ' } },
  { path: '/anime', name: 'anime', component: AnimeView, meta: { title: '动画' } },
  { path: '/light-novel', name: 'light-novel', component: LightNovelView, meta: { title: '小说' } },
  { path: '/manga', name: 'manga', component: MangaView, meta: { title: '漫画' } },
  { path: '/galgame', name: 'galgame', component: GalgameView, meta: { title: 'Galgame' } },
  { path: '/personal', name: 'personal', component: PersonalView, meta: { title: '个T��' } },
  { path: '/search', name: 'search', component: SearchView, meta: { title: '搜索' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } },
  // 设置子页：/settings/:group（account/storage/network/appearance），同一组件按 group 渲染对应分区
  { path: '/settings/:group', name: 'settings-group', component: SettingsView, props: true, meta: { title: '设置' } }
]

// Electron 下用 hash 模式，避�? file:// 路由问题
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由切换后把滚动容器归零：设置页等长页面滚到底部后跳转，
// 残留的大 scrollTop 会让新页面停在内容区之外（表现为「空白」）。
router.afterEach(() => {
  requestAnimationFrame(() => {
    const el = document.querySelector('.content')
    if (el) el.scrollTop = 0
  })
})

export default router
