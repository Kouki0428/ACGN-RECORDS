import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { fileURLToPath, URL } from 'node:url'

// 解析别名路径（兼容 Windows）
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      '@shared': r('./shared')
    },
    // 关键：让 .ts 优先于 .ts 同目录的陈旧 .js（tsc 误生成的产物），否则 Vite 默认 .js 优先
    // 会加载到旧的 .js，导致主进程 .ts 改动（如 getEpisodes 的 epNumber 修复）不生效。
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json']
  },
  plugins: [
    vue(),
    electron([
      {
        // 主进程入口
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // better-sqlite3 是原生模块，必须外置，不能打进 bundle；
              // https-proxy-agent 同样外置（运行时从 node_modules 加载，纯 JS、兼容 Node 20）
              external: ['better-sqlite3', 'https-proxy-agent']
            }
          }
        },
        onstart(options) {
          // 首发启动 electron；之后主进程改动则热重载窗口
          if (process.electronApp) {
            options.reload()
          } else {
            options.startup()
          }
        }
      },
      {
        // 预加载脚本入口
        // 注意：本项目 package.json 为 "type":"module"，vite-plugin-electron 默认会把
        // preload 打成 ESM（.js 带 import），而 Electron 在 nodeIntegration:false +
        // sandbox:false 下只能加载 CJS 格式的 preload，否则 exposeInMainWorld 不会执行、
        // 渲染进程 window.acgn 永远为 undefined。因此这里关闭 lib 模式并强制输出 CJS + .cjs
        // 扩展名（.cjs 不受 type:module 影响，永远按 CommonJS 加载）。
        entry: 'electron/preload.ts',
        vite: {
          build: {
            lib: false,
            rollupOptions: {
              input: 'electron/preload.ts',
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                chunkFileNames: 'preload.cjs',
                inlineDynamicImports: true
              }
            }
          }
        },
        onstart(options) {
          // preload 改动后热重载；首发时若 electron 尚未启动则启动之
          // （避免 main/preload 构建顺序竞态：若 preload 最后完成且只 reload，
          //   electron 永远不会被首次启动 → 不弹窗）
          if (process.electronApp) {
            options.reload()
          } else {
            options.startup()
          }
        }
      }
    ]),
    // 让渲染进程也能安全使用 node 能力（仅在需要时，本脚手架通过 preload 桥接）
    renderer()
  ],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist'
  }
})
