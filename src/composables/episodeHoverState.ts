import { ref } from 'vue'

/**
 * 跨所有 EpisodeGrid 实例共享的「当前哪个实例在显示悬停标记卡」单例。
 *
 * 关键：必须放在独立的模块文件里（真正的 module 作用域），
 * 不能放在 <script setup> 顶层——<script setup> 顶层声明是「每实例一份」，
 * 放里面会变成每个格子实例各自一个 openGridId，跨作品无法互斥，
 * 导致主页多部作品的单集标记悬浮窗同时出现。
 */
export const openGridId = ref(-1)

let _gridUid = 0
export function nextGridUid(): number {
  return ++_gridUid
}
