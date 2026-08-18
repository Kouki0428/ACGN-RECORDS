import sqlite3
uri = 'file:///C:/Users/yhq18/AppData/Roaming/acgn-records/acgn-records.db?mode=ro'
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()
cur.execute("SELECT id, username, substr(access_token,1,12) AS tok_prefix, length(access_token) AS tok_len FROM accounts WHERE provider='bangumi' ORDER BY id DESC LIMIT 1")
for r in cur.fetchall():
    print('id=%s username=%s tok_prefix=%r tok_len=%s' % r)
con.close()
