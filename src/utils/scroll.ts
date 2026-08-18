// 进入作品详情前记住的主内容滚动位置（列表视图「返回」时恢复）
let savedContentScroll = 0

/** 将主内容滚动容器（.content）滚到顶部，并记住进入前的位置。
 *  用于从列表进入作品详情：详情从顶部显示，同时保存列表滚动位置供返回时恢复。 */
export function scrollContentToTop() {
  const el = document.querySelector<HTMLElement>('.content')
  if (!el) return
  savedContentScroll = el.scrollTop
  el.scrollTop = 0
}

/** 恢复到上次进入详情前的主内容滚动位置。
 *  列表视图「返回」时调用，须在 DOM 更新后（如 nextTick）执行才能定位到列表正确高度。 */
export function restoreContentScroll() {
  const el = document.querySelector<HTMLElement>('.content')
  if (el) el.scrollTop = savedContentScroll
}
