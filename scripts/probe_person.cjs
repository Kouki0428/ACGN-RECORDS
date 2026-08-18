const { app, safeStorage } = require('electron')
const Database = require('better-sqlite3')

app.whenReady().then(async () => {
  try {
    const dbPath = 'C:/Users/yhq18/AppData/Roaming/acgn-records/acgn-records.db'
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare("SELECT id, provider, username, access_token FROM accounts WHERE provider='bangumi' ORDER BY id DESC LIMIT 1").get()
    db.close()
    if (!row || !row.access_token) { console.log('NO TOKEN ROW'); return }
    console.log('account id=%s provider=%s username=%s', row.id, row.provider, row.username)
    const enc = row.access_token
    let token
    if (enc.startsWith('enc:')) token = safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'))
    else if (enc.startsWith('b64:')) token = Buffer.from(enc.slice(4), 'base64').toString('utf8')
    else token = enc
    console.log('TOKEN_LEN:', token.length, 'PREFIX:', token.slice(0, 8) + '...')
    const UA = 'yhq18/ACGN-Records/0.1 (https://github.com/yhq18/acgn-records)'
    async function probe(name, url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body)
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch (e) {}
      const dataLen = Array.isArray(json && json.data) ? json.data.length : 'n/a'
      const first = json && Array.isArray(json.data) && json.data[0] ? JSON.stringify(json.data[0]).slice(0, 160) : '—'
      console.log(`[${name}] HTTP ${res.status} dataLen=${dataLen} total=${json && json.total} firstItem=${first}`)
      if (res.status !== 200) console.log(`   bodyHead=${text.slice(0, 240)}`)
    }
    await probe('subjects', 'https://api.bgm.tv/v0/search/subjects?limit=50&offset=0', { keyword: '凉宫', filter: { type: [1, 2, 4] } })
    await probe('characters', 'https://api.bgm.tv/v0/search/characters', { keyword: '凉宫', limit: 50, offset: 0 })
    await probe('persons', 'https://api.bgm.tv/v0/search/persons', { keyword: '凉宫', limit: 50, offset: 0 })
  } catch (e) {
    console.log('PROBE_ERR:', e && e.message, e && e.stack)
  } finally {
    app.quit()
  }
})
