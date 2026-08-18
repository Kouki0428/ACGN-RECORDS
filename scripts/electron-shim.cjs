// 最小 electron 桩：仅用于 esbuild 主进程打包「解析/导入」验证（非运行）。
// import electron from 'electron' 经 --alias:electron=本文件 解析；
// 任何属性/调用/构造都返回同一个 stub，保证打包不报「未解析」或「缺导出」。
const stub = new Proxy(function () {}, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined // 避免被当 Promise
    return stub
  },
  apply: () => stub,
  construct: () => stub
})
module.exports = stub
