// scripts/kill-stale.mjs
// 在 `npm run dev` 启动 vite 之前，清理上一轮 dev 残留的进程，避免：
//   1. 多个 Electron 窗口叠在一起（上次 electron.exe 没退干净）
//   2. vite 默认端口 5173 被旧进程占用导致 EADDRINUSE
// 仅做「尽力清理」，任何进程不存在 / 权限不足都静默忽略，不阻塞 dev 启动。
import { execSync, spawnSync } from 'node:child_process'
import process from 'node:process'

function tryRun(cmd, args = []) {
  try {
    const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true })
    return r.status === 0
  } catch {
    return false
  }
}

const isWin = process.platform === 'win32'

if (isWin) {
  // 关闭上次 dev 残留的 Electron 窗口，确保全新窗口启动
  tryRun('taskkill', ['/IM', 'electron.exe', '/F'])
  // 释放 5173 端口（vite 默认），避免 EADDRINUSE
  try {
    const out = execSync('netstat -ano', { windowsHide: true }).toString()
    const pids = new Set()
    for (const line of out.split('\n')) {
      if (/:5173\b/.test(line) && /LISTENING/.test(line)) {
        const cols = line.trim().split(/\s+/)
        const pid = cols[cols.length - 1]
        if (pid && /^\d+$/.test(pid)) pids.add(pid)
      }
    }
    for (const pid of pids) tryRun('taskkill', ['/PID', pid, '/F'])
  } catch {
    /* netstat 不可用则跳过端口清理 */
  }
} else {
  tryRun('pkill', ['-f', 'electron'])
  try {
    const out = execSync("lsof -ti:5173 || true").toString()
    for (const pid of out.split('\n').filter(Boolean)) tryRun('kill', ['-9', pid])
  } catch {
    /* lsof 不可用则跳过端口清理 */
  }
}

console.log('[kill-stale] stale dev processes cleaned')
