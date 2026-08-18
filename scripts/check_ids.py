import sqlite3
uri = 'file:///C:/Users/yhq18/AppData/Roaming/acgn-records/acgn-records.db?mode=ro'
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()
cur.execute('SELECT id, username, user_id, access_token IS NOT NULL AS has_access, refresh_token IS NOT NULL AS has_refresh, expires_at, updated_at FROM accounts ORDER BY id')
for r in cur.fetchall():
    print('id=%s username=%s user_id=%s has_access=%s has_refresh=%s expires_at=%s updated_at=%s' % r)
# 模拟 getBangumiAccount 的取数逻辑
cur.execute("SELECT id, username FROM accounts WHERE provider='bangumi' ORDER BY id DESC LIMIT 1")
print('getBangumiAccount(ORDER BY id DESC LIMIT 1) =>', cur.fetchone())
con.close()
