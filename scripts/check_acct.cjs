const Database = require('better-sqlite3');
const dbPath = 'C:/Users/yhq18/AppData/Roaming/acgn-records/acgn-records.db';
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (e) {
  console.log('OPEN_FAIL:', e.message);
  process.exit(0);
}
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('TABLES:', tables.map(function (t) { return t.name; }).join(', '));
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  console.log('ACCOUNTS_COLUMNS:', cols.map(function (c) { return c.name; }).join(', '));
  const rows = db.prepare('SELECT username, user_id, access_token IS NOT NULL AS has_access, refresh_token IS NOT NULL AS has_refresh, expires_at, updated_at FROM accounts').all();
  console.log('ACCOUNTS_ROWS:', JSON.stringify(rows, null, 2));
  const now = Math.floor(Date.now() / 1000);
  if (rows.length) {
    rows.forEach(function (r) {
      if (r.expires_at) {
        const expired = r.expires_at < now;
        console.log('expires_at=' + r.expires_at + ' now=' + now + ' expired=' + expired + ' (' + (expired ? '已过期' : '未过期') + ')');
      } else {
        console.log('expires_at=null => 个人令牌模式（无过期）');
      }
    });
  }
} catch (e) {
  console.log('QUERY_FAIL:', e.message);
} finally {
  db.close();
}
