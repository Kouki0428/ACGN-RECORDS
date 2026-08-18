import electron from 'electron'
const { app } = electron
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// 统一调试日志：写入 userData/debug.log。
// 绿色版下 userData 已被重定向到 exe 同级，因此日志也落在程序文件夹内，
// 不再写死系统盘 C:/temp，避免便携模式数据泄漏到系统目录。
// （这些调用点原为搜索/登录排查用的临时诊断日志，保留但收纳进程序目录。）
export function dbg(...args: unknown[]): void {
  try {
    const p = join(app.getPath('userData'), 'debug.log')
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(
      p,
      `[${new Date().toISOString()}] ` +
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') +
        '\n'
    )
  } catch {
    /* 忽略写入失败 */
  }
}
