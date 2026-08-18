// 用真实离线库验证「同步中文名补全」会产出中文名（逻辑与 archive.service.ts 的
// getArchiveExtra + 本仓库 applyCnPatch 一致）。不改变生产代码，仅做验证。
const Database = require('better-sqlite3')
const path = require('path')

const DB = 'C:/Users/yhq18/AppData/Roaming/acgn-records/bangumi-archive/bangumi-archive.db'
const db = new Database(DB, { readonly: true })

function extractCnFromWikiInfobox(infobox) {
  if (!infobox || typeof infobox !== 'string') return ''
  const m = infobox.match(/简体中文名\s*=\s*([^\n\r|{}]+)/)
  return m ? m[1].trim() : ''
}

function characterRelationLabel(t) {
  const MAP = { 1: '主角', 2: '配角', 3: '客串', 4: '旁白', 5: '闲角' }
  return MAP[t] || ''
}

function getArchiveExtra(subjectId) {
  const charRows = db
    .prepare(
      `SELECT sc.character_id AS id, sc.type AS relType, c.name AS name, c.infobox AS infobox
       FROM arc_subject_characters sc JOIN arc_characters c ON c.id = sc.character_id
       WHERE sc.subject_id = ? ORDER BY sc.type, sc.ord`
    )
    .all(subjectId)
  const characters = charRows.map((r) => {
    const actorRows = db
      .prepare(
        `SELECT p.id AS id, p.name AS name, p.infobox AS infobox
         FROM arc_person_characters pc JOIN arc_persons p ON p.id = pc.person_id
         WHERE pc.subject_id = ? AND pc.character_id = ?`
      )
      .all(subjectId, r.id)
    const actors = actorRows.map((a) => {
      const cn = extractCnFromWikiInfobox(a.infobox) || ''
      return { id: a.id, name: cn || a.name, nameCn: cn }
    })
    const cn = extractCnFromWikiInfobox(r.infobox) || ''
    return { id: r.id, name: cn || r.name, nameCn: cn, relation: characterRelationLabel(r.relType), actors }
  })

  const relRows = db
    .prepare(
      `SELECT sr.relation_type AS relation_type, sr.related_subject_id AS id, s.name AS name, s.name_cn AS name_cn, s.infobox AS infobox
       FROM arc_subject_relations sr JOIN arc_subjects s ON s.id = sr.related_subject_id
       WHERE sr.subject_id = ? ORDER BY sr.ord`
    )
    .all(subjectId)
  const relations = relRows.map((r) => {
    const cn = r.name_cn && r.name_cn.trim() ? r.name_cn : extractCnFromWikiInfobox(r.infobox) || ''
    return { id: r.id, name: cn || r.name, nameCn: cn, relation: String(r.relation_type) }
  })

  return { characters, relations }
}

const subj = Number(process.argv[2] || 295308)
const arc = getArchiveExtra(subj)
const charsWithCn = arc.characters.filter((c) => c.nameCn && c.nameCn.trim())
const relsWithCn = arc.relations.filter((r) => r.nameCn && r.nameCn.trim())
console.log(`subject=${subj}`)
console.log(`角色总数=${arc.characters.length}  有中文名=${charsWithCn.length}  中文率=${((charsWithCn.length / (arc.characters.length || 1)) * 100).toFixed(1)}%`)
console.log(`关联总数=${arc.relations.length}  有中文名=${relsWithCn.length}  中文率=${((relsWithCn.length / (arc.relations.length || 1)) * 100).toFixed(1)}%`)
console.log('--- 角色样例（前8）---')
for (const c of arc.characters.slice(0, 8)) {
  console.log(`  [${c.relation}] ${c.name}  (nameCn=${c.nameCn || '—'})  CV数=${c.actors.length}`)
}
console.log('--- 关联样例（前6）---')
for (const r of arc.relations.slice(0, 6)) {
  console.log(`  [rel=${r.relation}] ${r.name}  (nameCn=${r.nameCn || '—'})`)
}
db.close()
