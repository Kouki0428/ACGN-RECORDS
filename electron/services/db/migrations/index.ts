// 初始建表迁移（与技术方案设计文档第 3 节的 DDL 一致）
// 之后新增表 / 改表请追加独立的迁移脚本，并在 runMigrations 中按顺序执行。

export async function runMigrations(db: any): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT    NOT NULL DEFAULT 'bangumi',
      username      TEXT,
      user_id       INTEGER,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      provider           TEXT    NOT NULL,
      provider_subject_id TEXT   NOT NULL,
      category           TEXT    NOT NULL,
      title              TEXT,
      title_cn           TEXT,
      summary            TEXT,
      image_url          TEXT,
      air_date           TEXT,
      end_date           TEXT,
      total_episodes     INTEGER,
      total_volumes      INTEGER,
      rating             REAL,
      raw_json           TEXT,
      created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(provider, provider_subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_subjects_category ON subjects(category);

    CREATE TABLE IF NOT EXISTS collections (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       INTEGER NOT NULL,
      subject_id       INTEGER NOT NULL,
      status           INTEGER NOT NULL DEFAULT 3,
      ep_status        INTEGER DEFAULT 0,
      vol_status       INTEGER DEFAULT 0,
      route_status     INTEGER DEFAULT 0,
      rating           INTEGER,
      comment          TEXT,
      private          INTEGER DEFAULT 0,
      last_sync_at     INTEGER,
      local_updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      dirty            INTEGER NOT NULL DEFAULT 0,
      dirty_rate       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, subject_id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status);

    CREATE TABLE IF NOT EXISTS episodes (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id         INTEGER NOT NULL,
      provider_episode_id TEXT,
      ep_number          INTEGER,
      ep_type            INTEGER DEFAULT 0,
      title              TEXT,
      airdate            TEXT,
      comment_count      INTEGER DEFAULT 0,
      sort               INTEGER,
      raw_json           TEXT,
      UNIQUE(subject_id, provider_episode_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_subject ON episodes(subject_id);

    CREATE TABLE IF NOT EXISTS episode_progress (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      episode_id    INTEGER NOT NULL,
      watched       INTEGER NOT NULL DEFAULT 0,
      watched_at    INTEGER,
      FOREIGN KEY (collection_id) REFERENCES collections(id),
      FOREIGN KEY (episode_id) REFERENCES episodes(id),
      UNIQUE(collection_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      color TEXT
    );
    CREATE TABLE IF NOT EXISTS collection_tags (
      collection_id INTEGER NOT NULL,
      tag_id        INTEGER NOT NULL,
      PRIMARY KEY (collection_id, tag_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL UNIQUE,
      platform      TEXT,
      price         REAL,
      currency      TEXT DEFAULT 'CNY',
      purchased_at  INTEGER,
      note          TEXT,
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_collection ON purchases(collection_id);

    CREATE TABLE IF NOT EXISTS sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      direction  TEXT,
      entity     TEXT,
      entity_id  INTEGER,
      status     TEXT,
      message    TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS subject_external_links (
      subject_id INTEGER NOT NULL,
      source     TEXT NOT NULL,
      ext_id     TEXT NOT NULL,
      url        TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (subject_id, source),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_extlinks_subject ON subject_external_links(subject_id);

    CREATE TABLE IF NOT EXISTS subject_gallery (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      source     TEXT NOT NULL,
      url        TEXT NOT NULL,
      thumb      TEXT,
      caption    TEXT,
      fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_subject ON subject_gallery(subject_id);

    CREATE TABLE IF NOT EXISTS subject_characters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      char_id    INTEGER NOT NULL,
      name       TEXT,
      image      TEXT,
      relation   TEXT,
      actors_json TEXT,
      UNIQUE(subject_id, char_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_char_subject ON subject_characters(subject_id);

    CREATE TABLE IF NOT EXISTS subject_relations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      related_id INTEGER NOT NULL,
      name       TEXT,
      image      TEXT,
      type       INTEGER,
      relation   TEXT,
      UNIQUE(subject_id, related_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_rel_subject ON subject_relations(subject_id);

    -- 通关路线（Galgame）：每一条已通关路线存一行（路线名），依附于本地收藏。
    -- 路线条数即「已通关路线数」，与 collections.ep_status 保持同步（由业务层写入）。
    CREATE TABLE IF NOT EXISTS routes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      position      INTEGER NOT NULL DEFAULT 0,
      name          TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );
    CREATE INDEX IF NOT EXISTS idx_routes_collection ON routes(collection_id);

    -- 本地剧集缓存：Bangumi 真实剧集元数据（集号/标题/首播/时长），按 provider_subject_id 缓存，
    -- 悬浮窗/详情页优先读本地、避免每次打开都联网抓取（见 episodesCache.repository.ts）。
    CREATE TABLE IF NOT EXISTS subject_episodes (
      provider_subject_id TEXT    NOT NULL,
      episode_id           INTEGER NOT NULL,
      ep_number            INTEGER,
      ep                   INTEGER,
      title                TEXT,
      airdate              TEXT,
      duration             TEXT,
      ep_type              INTEGER DEFAULT 0,
      updated_at           INTEGER,
      PRIMARY KEY (provider_subject_id, episode_id)
    );
    CREATE INDEX IF NOT EXISTS idx_subject_episodes_pid ON subject_episodes(provider_subject_id);

    -- 自动清理（pruneStaleCache>）按 updated_at 半年筛选删除剧集缓存；
    -- 存量旧行 updated_at 可能为 NULL（早期版本插入未写该列），一次性回填为当前时间（视为刚刷新），
    -- 避免首跑误删全部存量剧集缓存，也保证半年未打开的作品后续能被正常裁剪。
    -- 幂等：每次打开执行，仅更新 NULL 行（无 NULL 时影响 0 行）。
    UPDATE subject_episodes SET updated_at = strftime('%s','now') WHERE updated_at IS NULL;

    -- 单集评论本地草稿（用户自己发的单集评论）：真发 Bangumi 成功前先落本地（synced=0），
    -- 成功后回填 provider_comment_id 并置 synced=1。与 p1 取回的他人评论按 provider_comment_id 去重。
    CREATE TABLE IF NOT EXISTS episode_comments (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_subject_id  TEXT    NOT NULL,
      provider_episode_id  TEXT    NOT NULL,
      provider_comment_id  INTEGER,
      content              TEXT    NOT NULL,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      synced               INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_episode_comments_ep ON episode_comments(provider_episode_id);
  `)

  // better-sqlite3 的 ALTER TABLE 不支持 IF NOT EXISTS，这里用 pragma 探测后按需加列
  const cols = (db.prepare("PRAGMA table_info(subjects)").all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!cols.includes('tags')) {
    db.exec('ALTER TABLE subjects ADD COLUMN tags TEXT')
  }
  if (!cols.includes('infobox')) {
    db.exec('ALTER TABLE subjects ADD COLUMN infobox TEXT')
  }
  // VNDB 评分（Galgame 区展示，离线缓存）；缺省不强制
  if (!cols.includes('vndb_rating')) {
    db.exec('ALTER TABLE subjects ADD COLUMN vndb_rating REAL')
  }
  if (!cols.includes('vndb_rating_count')) {
    db.exec('ALTER TABLE subjects ADD COLUMN vndb_rating_count INTEGER')
  }

  // 评分分布（Bangumi 1–10 星票数，离线缓存供详情页柱状图）
  const scols = (db.prepare('PRAGMA table_info(subjects)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!scols.includes('rating_count')) {
    db.exec('ALTER TABLE subjects ADD COLUMN rating_count TEXT')
  }
  if (!scols.includes('rating_total')) {
    db.exec('ALTER TABLE subjects ADD COLUMN rating_total INTEGER')
  }

  // 书籍「系列 / 单行本」标志位（Bangumi series 布尔，存为 INTEGER 0/1；null=未获取）。
  // 非系列（单行本）不显示「已读卷」。
  const serCols = (db.prepare('PRAGMA table_info(subjects)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!serCols.includes('series')) {
    db.exec('ALTER TABLE subjects ADD COLUMN series INTEGER')
  }

  // 画廊增加 nsfw 标记列（VNDB 截图按分级判定，用于 R18 模糊遮罩）
  const gcols = (db.prepare('PRAGMA table_info(subject_gallery)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!gcols.includes('nsfw')) {
    db.exec('ALTER TABLE subject_gallery ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0')
  }
  // 画廊缓存版本号：旧版本缓存含封面图，作废旧缓存（v<2 的视为无效、重新抓取）
  if (!gcols.includes('v')) {
    db.exec('ALTER TABLE subject_gallery ADD COLUMN v INTEGER NOT NULL DEFAULT 0')
  }

  // 单集评论支持「子评论/回复」：本地草稿需记录父评论 id（父评论当前的 id：
  // 远程评论=provider id，本地草稿=本地 id），用于本地归并、把子评论显示到对应父评论下。
  const ecCols = (db.prepare('PRAGMA table_info(episode_comments)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!ecCols.includes('parent_id')) {
    db.exec('ALTER TABLE episode_comments ADD COLUMN parent_id INTEGER')
  }

  // 本地剧集缓存 subject_episodes.ep_number 原为 INTEGER，会把 Bangumi 特别篇的小数 sort
  // （如 4.5 / 13.5，插在正片之间的 SP）截断成整数，导致特别篇显示错位/重复。改为 REAL
  // （一次性迁移，仅当 ep_number 仍为 INTEGER 时执行；数据原样复制，缓存可重新联网补全）。
  const seCols = db
    .prepare('PRAGMA table_info(subject_episodes)')
    .all() as { name: string; type: string }[]
  const epNumCol = seCols.find((c) => c.name === 'ep_number')
  if (epNumCol && /INTEGER/i.test(epNumCol.type)) {
    db.exec(`
      ALTER TABLE subject_episodes RENAME TO _subject_episodes_tmp;
      CREATE TABLE subject_episodes (
        provider_subject_id TEXT    NOT NULL,
        episode_id           INTEGER NOT NULL,
        ep_number            REAL,
        ep                   INTEGER,
        title                TEXT,
        airdate              TEXT,
        duration             TEXT,
        ep_type              INTEGER DEFAULT 0,
        updated_at           INTEGER,
        PRIMARY KEY (provider_subject_id, episode_id)
      );
      INSERT INTO subject_episodes (provider_subject_id, episode_id, ep_number, ep, title, airdate, duration, ep_type, updated_at)
        SELECT provider_subject_id, episode_id, ep_number, ep, title, airdate, duration, ep_type, updated_at
        FROM _subject_episodes_tmp;
      DROP TABLE _subject_episodes_tmp;
    `)
  }

  // 剧集进度：去掉 episode_id 上的外键约束，并新增 want 列（想看单集）。
  // 旧表 episode_progress 对 episode_id 有 REFERENCES episodes(id) 的外键，但悬浮窗等场景下
  // 进度需直接以 Bangumi 剧集 id 为键（本地 episodes 表未必存在该 id），外键会导致 INSERT 失败。
  // SQLite 不支持 ALTER 去列约束，故用「建新表→复制→删旧表→改名」重建。幂等：want 存在即跳过。
  const epCols = (db.prepare('PRAGMA table_info(episode_progress)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!epCols.includes('want')) {
    db.exec(`
      CREATE TABLE episode_progress_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        episode_id    INTEGER NOT NULL,
        watched       INTEGER NOT NULL DEFAULT 0,
        want          INTEGER NOT NULL DEFAULT 0,
        watched_at    INTEGER,
        UNIQUE(collection_id, episode_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id)
      );
      INSERT INTO episode_progress_new (id, collection_id, episode_id, watched, watched_at)
        SELECT id, collection_id, episode_id, watched, watched_at FROM episode_progress;
      DROP TABLE episode_progress;
      ALTER TABLE episode_progress_new RENAME TO episode_progress;
    `)
  }

  // 剧集进度：新增 dropped 列（抛弃单集，对应 Bangumi episode type=3）。
  // 重建后的表已无 episode_id 外键，直接 ALTER 加列即可（幂等：pragma 探测后按需加）。
  const epCols2 = (db.prepare('PRAGMA table_info(episode_progress)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!epCols2.includes('dropped')) {
    db.exec('ALTER TABLE episode_progress ADD COLUMN dropped INTEGER NOT NULL DEFAULT 0')
  }

  // 逐字段 dirty：dirty_rate 标记「评分被显式改动待上传」。
  // 仅 updateCollectionRating 置 1；改状态/集数/卷数/吐槽只动整行 dirty，不碰 dirty_rate，
  // 避免整行推送时把本地 rating=0 当 rate=0 发出去误删 Bangumi 上已有的评分。
  // 旧库缺列则按需 ALTER（幂等）。
  const collCols = (db.prepare('PRAGMA table_info(collections)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!collCols.includes('dirty_rate')) {
    db.exec('ALTER TABLE collections ADD COLUMN dirty_rate INTEGER NOT NULL DEFAULT 0')
  }

  // 官方/系统标签：subjects 加 meta_tags 列（JSON 数组字符串，存 Bangumi meta_tags 顶层字符串数组）。
  // 与用户自由标注的 tags 区分。旧库缺列则按需 ALTER（幂等：PRAGMA 探测后加）。
  const subjCols = (db.prepare('PRAGMA table_info(subjects)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!subjCols.includes('meta_tags')) {
    db.exec('ALTER TABLE subjects ADD COLUMN meta_tags TEXT')
  }
  // NSFW 标记（是否 R18）：存档库 arc_subjects.nsfw 回流，用于封面模糊/隐藏。
  // 幂等：缺列则按需 ALTER。
  if (!subjCols.includes('nsfw')) {
    db.exec('ALTER TABLE subjects ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0')
  }

  // 应用网络使用量月度统计：以 month='YYYY-MM' 为主键聚合当月上行/下行字节与请求次数。
  // 由 safeFetch 埋点经 networkStats.repository 增量 upsert。幂等建表。
  db.exec(
    `CREATE TABLE IF NOT EXISTS network_stats (
      month    TEXT PRIMARY KEY,
      sent     INTEGER NOT NULL DEFAULT 0,
      received INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0
    )`
  )
  // 按域名拆分请求次数（bgm 域 vs 其它域），便于区分「bgm API」与「画廊/离线库等其它」流量。
  // 幂等：缺列则 ALTER。
  const nsCols = (db.prepare('PRAGMA table_info(network_stats)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!nsCols.includes('bgm_requests')) db.exec('ALTER TABLE network_stats ADD COLUMN bgm_requests INTEGER NOT NULL DEFAULT 0')
  if (!nsCols.includes('other_requests')) db.exec('ALTER TABLE network_stats ADD COLUMN other_requests INTEGER NOT NULL DEFAULT 0')

  // 应用网络使用量日度统计：以 day='YYYY-MM-DD' 为主键聚合当天上行/下行字节与请求次数。
  // 供设置页「网络使用量」展示当天请求次数。幂等建表。
  db.exec(
    `CREATE TABLE IF NOT EXISTS network_stats_daily (
      day      TEXT PRIMARY KEY,
      sent     INTEGER NOT NULL DEFAULT 0,
      received INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0
    )`
  )
  const nsdCols = (db.prepare('PRAGMA table_info(network_stats_daily)').all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!nsdCols.includes('bgm_requests')) db.exec('ALTER TABLE network_stats_daily ADD COLUMN bgm_requests INTEGER NOT NULL DEFAULT 0')
  if (!nsdCols.includes('other_requests')) db.exec('ALTER TABLE network_stats_daily ADD COLUMN other_requests INTEGER NOT NULL DEFAULT 0')

  // 收藏月度快照：每月首次启动记录当期计数，供统计悬浮窗绘制历史趋势曲线。幂等建表。
  db.exec(
    `CREATE TABLE IF NOT EXISTS stats_snapshots (
      month      TEXT PRIMARY KEY,
      total      INTEGER NOT NULL DEFAULT 0,
      done       INTEGER NOT NULL DEFAULT 0,
      rated      INTEGER NOT NULL DEFAULT 0,
      avg_rating REAL    NOT NULL DEFAULT 0,
      anime      INTEGER NOT NULL DEFAULT 0,
      book       INTEGER NOT NULL DEFAULT 0,
      game       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`
  )

  // 通用只读数据缓存：把 Bangumi 详情类接口的响应按 key 暂存到本地硬盘，
  // 有效期内直接返回、不再发网络请求（详见 services/api/requestCache.ts）。
  // value 存 JSON 文本，expires_at 为绝对过期时间戳（秒）。幂等建表。
  db.exec(
    `CREATE TABLE IF NOT EXISTS cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  )
}
