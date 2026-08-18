/** 渲染进程对本地数据库的受限封装（仅暴露 query / run）。 */
export const dbClient = {
  query: <T = any>(sql: string, params?: unknown[]): Promise<T[]> =>
    window.acgn.db.query(sql, params) as Promise<T[]>,
  run: (sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number; changes: number }> =>
    window.acgn.db.run(sql, params)
}
