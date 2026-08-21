import type { Category } from '@shared/types'
import { statusVerbs } from '@/utils/collectionVerbs'
import { collectionClient } from '@/services/collectionClient'
import { useToast } from './useToast'
import type { MenuItem } from './useContextMenu'

// 列表卡片右键菜单构建器：快速改收藏状态 / 在 Bangumi 打开 / 删除收藏。
// 状态改动 = setStatus(标 dirty) + 立即 pushAll（与收藏悬浮窗「保存」的即时上传语义一致）。

export interface CardMenuTarget {
  providerSubjectId?: string
  collectionId: number
  /** 当前收藏状态（Bangumi type 1-5）；缺省视为未知（无勾选项） */
  status?: number
  category: Category
  title: string
}

export function buildCardMenu(
  t: CardMenuTarget,
  opts: { onChanged?: () => void } = {}
): MenuItem[] {
  const toast = useToast()
  const verbs = statusVerbs(t.category) // 下标 i 对应 Bangumi type i+1
  const items: MenuItem[] = []

  // —— 快速改状态（当前状态打勾）——
  for (let s = 1; s <= 5; s++) {
    const target = s
    const isCurrent = t.status === s
    items.push({
      key: `status-${s}`,
      label: verbs[s - 1],
      checked: isCurrent,
      disabled: isCurrent,
      separatorBefore: s === 1,
      action: async () => {
        try {
          await collectionClient.setStatus(t.collectionId, target)
          void window.acgn.sync.pushAll().catch(() => {})
          toast.ok(`已标记为「${verbs[target - 1]}」`)
          opts.onChanged?.()
        } catch (e) {
          toast.err(`标记失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    })
  }

  // —— 在 Bangumi 打开 ——
  if (t.providerSubjectId && /^\d+$/.test(String(t.providerSubjectId))) {
    items.push({
      key: 'open-bgm',
      label: '在 Bangumi 打开',
      separatorBefore: true,
      action: () => {
        void window.acgn.app.openExternal(`https://bgm.tv/subject/${t.providerSubjectId}`)
      }
    })
  }

  // —— 删除收藏（confirm 二次确认：本地 + Bangumi 同删，不可撤销）——
  if (t.providerSubjectId) {
    items.push({
      key: 'delete',
      label: '删除收藏…',
      danger: true,
      action: async () => {
        const ok = window.confirm(`确定删除《${t.title}》的收藏吗？\n将同时从 Bangumi 移除该收藏，不可撤销。`)
        if (!ok) return
        try {
          await collectionClient.deleteCollection(String(t.providerSubjectId))
          toast.ok('已取消收藏')
          opts.onChanged?.()
        } catch (e) {
          toast.err(`删除失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    })
  }

  return items
}
