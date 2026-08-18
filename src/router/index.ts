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
  { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } }
]

// Electron 下用 hash 模式，避�? file:// 路由问题
export default createRouter({
  history: createWebHashHistory(),
  routes
})
