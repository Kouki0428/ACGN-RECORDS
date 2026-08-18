<script setup lang="ts">
import { computed } from 'vue'
// 购买信息：平台 + 价格（仅 Galgame / 单机游戏 模块使用）
const model = defineModel<{ platform: string; price: number; currency: string }>({
  default: () => ({ platform: '', price: 0, currency: 'CNY' })
})

const currencies = [
  { code: 'CNY', label: '¥ 人民币' },
  { code: 'USD', label: '$ 美元' },
  { code: 'JPY', label: '¥ 日元' },
  { code: 'EUR', label: '€ 欧元' },
  { code: 'RUB', label: '₽ 卢布' }
]

// 购买平台候选（选择项，而非自由填空）
const KNOWN_PLATFORMS = [
  'Steam',
  'DLsite',
  'DMM',
  'Epic',
  'WeGame',
  '实体'
]
// 「其它」选项的下拉值（选中后平台存为可读的「其它」，不再需要自定义文本输入）
const OTHER = '__other__'

const platformOptions = [
  ...KNOWN_PLATFORMS.map((p) => ({ value: p, label: p })),
  { value: OTHER, label: '其它' }
]

// 下拉框的绑定值
const selectVal = computed<string>({
  get: () => {
    if (model.value.platform === '' || model.value.platform === '其它')
      return model.value.platform === '其它' ? OTHER : ''
    if (KNOWN_PLATFORMS.includes(model.value.platform)) return model.value.platform
    return OTHER // 历史自定义值 → 归到「其它」
  },
  set: (v: string) => {
    if (v === OTHER) {
      // 从已知平台切到「其它」时，存为可读的「其它」
      if (KNOWN_PLATFORMS.includes(model.value.platform)) model.value.platform = '其它'
      // 已是自定义/哨兵则保持
    } else {
      model.value.platform = v
    }
  }
})
</script>

<template>
  <section class="panel purchase">
    <div class="panel-head">
      <div class="panel-title-group">
        <h3>购买信息</h3>
        <span class="hint">仅保存在本地</span>
      </div>
      <div class="panel-actions">
        <slot name="actions" />
      </div>
    </div>

    <div class="purchase-grid">
      <label class="field">
        <span>购买平台</span>
        <select class="input" v-model="selectVal">
          <option value="">请选择平台</option>
          <option v-for="o in platformOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>

      <label class="field">
        <span>价格</span>
        <input class="input" v-model.number="model.price" type="number" min="0" step="0.01" />
      </label>

      <label class="field">
        <span>币种</span>
        <select class="input" v-model="model.currency">
          <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
        </select>
      </label>
    </div>
  </section>
</template>

<style scoped>
.panel-title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.panel-title-group .hint {
  margin: 0;
  line-height: 1;
}
.panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.purchase-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 560px) {
  .purchase-grid {
    grid-template-columns: 1fr;
  }
}
</style>
