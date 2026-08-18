import sqlite3, time
db = r'C:\Users\yhq18\AppData\Roaming\acgn-records\acgn-records.db'
uri = 'file:///C:/Users/yhq18/AppData/Roaming/acgn-records/acgn-records.db?mode=ro'
try:
    con = sqlite3.connect(uri, uri=True)
except Exception as e:
    print('OPEN_FAIL:', e)
    raise SystemExit
cur = con.cursor()
try:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tabs = [r[0] for r in cur.fetchall()]
    print('TABLES:', ', '.join(tabs))
    if 'accounts' in tabs:
        cur.execute('PRAGMA table_info(accounts)')
        cols = [r[1] for r in cur.fetchall()]
        print('ACCOUNTS_COLUMNS:', ', '.join(cols))
        cols_needed = [c for c in ['username','user_id','access_token','refresh_token','expires_at','updated_at'] if c in cols]
        cur.execute('SELECT ' + ', '.join(cols_needed) + ' FROM accounts')
        rows = cur.fetchall()
        print('ACCOUNTS_ROWS_COUNT:', len(rows))
        now = int(time.time())
        for row in rows:
            d = dict(zip(cols_needed, row))
            has_access = d.get('access_token') is not None and len(str(d.get('access_token'))) > 0
            has_refresh = d.get('refresh_token') is not None and len(str(d.get('refresh_token'))) > 0
            ea = d.get('expires_at')
            if ea:
                print('  username=%s user_id=%s has_access=%s has_refresh=%s expires_at=%s (now=%s expired=%s) updated_at=%s' % (
                    d.get('username'), d.get('user_id'), has_access, has_refresh, ea, now, ea < now, d.get('updated_at')))
            else:
                print('  username=%s user_id=%s has_access=%s has_refresh=%s expires_at=None(个人令牌) updated_at=%s' % (
                    d.get('username'), d.get('user_id'), has_access, has_refresh, d.get('updated_at')))
    else:
        print('NO accounts TABLE')
finally:
    con.close()
