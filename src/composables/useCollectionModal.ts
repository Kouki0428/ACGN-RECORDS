import { ref } from 'vue'
import type { Category } from '@shared/types'
import { collectionClient } from '@/services/collectionClient'

/**
 * 收藏悬浮窗（CollectionModal）的全局单例状态。
 * 任意位置（详情页 / 作品悬浮窗的 CollectionBar）调用 open() 即可打开同一个模态，
 * 关闭后状态复位。save/remove 通过 collectionClient 落地（本地 + 同步 Bangumi），
 * 完成后 refreshTick++ 通知所有 CollectionBar 重新拉取「是否已收藏」状态。
 */
const isOpen = ref(false)
const providerSubjectId = ref('')
const category = ref<Category>('anime')
const mode = ref<'add' | 'edit'>('add')
/** 预选中 / 高亮的状态（add 模式为点击进入的状态；edit 模式为当前已收藏状态） */
const currentStatus = ref(1)
/** 预填吐槽（edit 模式为当前吐槽） */
const comment = ref('')
/** 预填「仅自己可见」勾选（edit 模式为当前 private） */
const isPrivate = ref(false)
/** 「我的评价」评分（1-10）；null 表示未评 / 清除；仅当 selectedStatus !== 1 时参与保存 */
const rating = ref<number | null>(null)
/** 每次保存 / 删除成功后自增，供 CollectionBar watch 以刷新本地状态 */
const refreshTick = ref(0)

export function useCollectionModal() {
  function open(
    pid: string,
    cat: Category,
    opts?: {
      mode?: 'add' | 'edit'
      currentStatus?: number
      comment?: string
      private?: boolean
      rating?: number | null
    }
  ) {
    providerSubjectId.value = pid
    category.value = cat
    mode.value = opts?.mode ?? 'add'
    currentStatus.value = opts?.currentStatus ?? 1
    comment.value = opts?.comment ?? ''
    isPrivate.value = opts?.private ?? false
    rating.value = opts?.rating ?? null
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  /** 保存收藏（新建或更新），成功后通知刷新并关闭 */
  async function save(status: number, payload: { comment: string; private: boolean; rating?: number | null }) {
    await collectionClient.saveCollection({
      providerSubjectId: providerSubjectId.value,
      status,
      comment: payload.comment,
      private: payload.private,
      rating: payload.rating
    })
    refreshTick.value++
    close()
  }

  /** 删除收藏，成功后通知刷新并关闭 */
  async function remove() {
    await collectionClient.deleteCollection(providerSubjectId.value)
    refreshTick.value++
    close()
  }

  return {
    isOpen,
    providerSubjectId,
    category,
    mode,
    currentStatus,
    comment,
    isPrivate,
    rating,
    refreshTick,
    open,
    close,
    save,
    remove
  }
}
