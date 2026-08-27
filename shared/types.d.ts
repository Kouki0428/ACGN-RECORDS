export type Provider = 'bangumi' | 'tmdb' | 'vndb';
export type Category = 'anime' | 'light_novel' | 'manga' | 'galgame';
/** 作品标签（来自 Bangumi tags，含被标记次数） */
export interface SubjectTag {
    name: string;
    count: number;
}
/** 制作信息条目（来自 Bangumi infobox，如 制作公司 / 出版社 / 平台 / 声优 等） */
export interface SubjectMeta {
    key: string;
    value: string;
}
/** 角色（来自 Bangumi 角色列表：名字 / 关系(主角·配角·客串) / 头像 / CV 声优） */
export interface SubjectCharacter {
    id: number;
    name: string;
    /** 真正取到的中文译名（来自 infobox 简体中文名）；空串表示未取到。用于合并时优先中文、避免被原名覆盖 */
    nameCn?: string;
    image?: string;
    /** 角色关系：主角 / 配角 / 客串（Bangumi relation 字段） */
    relation: string;
    /** 配音演员（CV），可能为空；id 用于跳转 Bangumi person 页 */
    actors: {
        id?: number;
        name: string;
        nameCn?: string;
        image?: string;
    }[];
}
/** 关联作品（来自 Bangumi 关联条目：前传 / 续集 / 外传 等，含封面与类型） */
export interface SubjectRelation {
    id: number;
    name: string;
    /** 真正取到的中文译名（来自条目顶层 name_cn）；空串表示未取到 */
    nameCn?: string;
    image?: string;
    /** Bangumi 作品类型（1=书籍 2=动画 4=游戏 6=三次元 …） */
    type: number;
    /** 关联类型：续集 / 前传 / 外传 / 同名作品 … */
    relation: string;
}
/** 制作/创作人员（来自 Bangumi 作品 staff：作者 / 导演 / 原画 / 制作公司 等，对应 /subjects/{id}/persons）。
 *  用于把「制作信息」里的人名/公司名渲染成可点击项，跳转对应的人物悬浮窗（kind='person'）。 */
export interface SubjectPerson {
    id: number;
    /** 显示名（优先中文名 name_cn，其次原名 name） */
    name: string;
    /** 中文名（Bangumi persons 列表返回 name_cn 则取之；否则空串） */
    nameCn?: string;
    /** 职位/关系（Bangumi relation，如 导演 / 原作 / 动画制作 / 角色设计 / 出版社 …） */
    relation: string;
    image?: string;
}
/** 统一作品模型：所有数据源归一化后的标准结构。
 *  数据以 Bangumi 为主（provider='bangumi' 为权威记录），
 *  其它源（tmdb/vndb/dlsite/steam）仅作为辅助外链存在。 */
export interface Subject {
    provider: Provider;
    providerSubjectId: string;
    category: Category;
    title: string;
    titleCn?: string;
    summary?: string;
    imageUrl?: string;
    airDate?: string;
    totalEpisodes?: number;
    totalVolumes?: number;
    rating?: number;
    /** Bangumi 评分分布：长度 10 的数组，索引 i 对应 (i+1) 星的票数（1–10 星），仅 Bangumi 作品联网详情时填充 */
    ratingCount?: number[];
    /** 评分总人数（= ratingCount 之和，或直接取 Bangumi rating.total），仅联网详情时填充 */
    ratingTotal?: number;
    /** 标签（来自 Bangumi tags），仅在详情/同步补全时填充 */
    tags?: SubjectTag[];
    /** 制作信息（来自 Bangumi infobox，已扁平化），仅在详情/同步补全时填充 */
    meta?: SubjectMeta[];
    /** 辅助源外链 id，如 { vndb: 'v17', tmdb: '123' }（搜索时按标题匹配写入） */
    externalLinks?: Record<string, string>;
}
/** 单条「其它用户的吐槽」（来自 Bangumi 条目吐槽区 next.bgm.tv/p1/subjects/{id}/comments） */
export interface SubjectComment {
    id: number;
    content: string;
    /** 评论更新时间戳（秒，来自 Bangumi updatedAt） */
    createdAt: number | string | null;
    /** 该用户给条目的评分（1-10，0 表示未评分） */
    rate: number;
    /** 该用户的收藏状态（Bangumi collection type）：1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃；0 表示未知 */
    collectionType: number;
    creator: {
        username: string;
        nickname: string;
        avatar: string | null;
    };
}
/** CG / 截图示例图（Galgame 详情画廊），仅存远程 URL */
export interface GalleryItem {
    /** 来源：vndb | dlsite | steam */
    source: string;
    url: string;
    thumb?: string;
    caption?: string;
    /** 是否 R18（VNDB 截图按 sexual/violence 分级判定），用于模糊遮罩 */
    nsfw?: boolean;
}
/** 单张画廊图（已结构化，供 GameGallery 使用） */
export interface GameGalleryImage {
    url: string;
    thumb?: string;
    caption?: string;
    /** 是否 R18（仅 VNDB 截图带分级；DLsite/Steam 默认 false） */
    nsfw?: boolean;
}
/** 游戏画廊（复刻 Bangumi「游戏画廊」超合金组件）：按来源分组的 CG / 截图 */
export interface GameGallery {
    vndb: GameGalleryImage[];
    dlsite: GameGalleryImage[];
    steam: GameGalleryImage[];
    /** 默认展示的来源（按 dlsite → vndb → steam 优先级，取第一个有图源的） */
    defaultSource: 'vndb' | 'dlsite' | 'steam';
    /** VNDB 评分（0-10，带 2 位小数），仅 Galgame 区展示；无则缺省 */
    vndbRating?: number;
    /** VNDB 评分人数 */
    vndbRatingCount?: number;
}
/** 搜索域：条目（Bangumi subject）/ 人物（角色 + 现实人物） */
export type SearchDomain = 'subject' | 'person';
/** 条目子分类（对应 Bangumi subject type：动画=2 / 书籍=1 / 游戏=4） */
export type SubjectFilter = 'all' | 'anime' | 'book' | 'game';
/** 人物子分类：虚拟=角色(character) / 现实=人物(person) */
export type PersonFilter = 'all' | 'virtual' | 'real';
/** 统一搜索请求：keyword + 域 + 对应子分类过滤 */
export interface SearchQuery {
    keyword: string;
    domain: SearchDomain;
    /** 条目子类型（domain==='subject' 时有效） */
    subjectType?: SubjectFilter;
    /** 人物子类型（domain==='person' 时有效） */
    personType?: PersonFilter;
}
export interface SearchSubjectItem {
    kind: 'subject';
    subject: Subject;
}
export interface SearchPersonItem {
    kind: 'person';
    /** Bangumi 角色 / 人物 id */
    id: string;
    /** 显示名（优先中文名） */
    name: string;
    nameCn?: string;
    imageUrl?: string;
    /** 虚拟=角色 / 现实=人物 */
    personKind: 'character' | 'person';
}
export type SearchResultItem = SearchSubjectItem | SearchPersonItem;
export interface AppInfo {
    name: string;
    version: string;
}
/** 角色/人物详情卡（点击详情页角色或 CV 打开，替代跳转 bgm 网页）的 infobox 项 */
export interface EntityInfoboxItem {
    key: string;
    value: string;
}
/** 详情卡里的「出演作品 / 出演角色 / 关联角色」条目 */
export interface EntityWorkItem {
    id: number;
    name: string;
    /** 中文名（优先），无则空串 */
    nameCn: string;
    image: string;
    /** 关系（出演作品里是「主角/配角…」，出演角色里是角色名对应的关系，关联角色为空） */
    relation: string;
    /** 配音演员（CV）列表，含 id（用于点击跳转人物卡）与显示名；仅「关联角色」条目附带（来自详情页角色列表的 actors） */
    cvs?: {
        id?: number;
        name: string;
    }[];
    /** 该角色（在人物卡「出演角色」里）出演的作品列表；仅人物卡附带，用于角色小栏右侧展示 */
    works?: EntityWorkItem[];
    /**
     * 排序用日期（来自本地 Archive 库 arc_subjects.date，YYYY-MM-DD）。
     * 出演角色条目取的是其「最晚出演作品」的日期；无日期（Archive 库缺失该作品 / 角色无任何作品）为 undefined。
     * 渲染层据此排序：asc=旧→新、desc=新→旧；**缺失日期恒排最后，与正序/倒序无关**。
     */
    date?: string;
}
/** 角色/人物详情卡完整数据（由主进程 /v0/characters|persons/{id} 及其子端点聚合） */
export interface EntityDetail {
    kind: 'character' | 'person';
    id: number;
    /** 显示名（优先中文名，其次原名） */
    name: string;
    /** 立绘/头像 URL（large 优先，其次 medium） */
    image: string;
    /** 原始 infobox（key/value 数组），用于左侧信息区 */
    infobox: EntityInfoboxItem[];
    /** 介绍（summary） */
    summary: string;
    /** 出演作品（角色：/characters/{id}/subjects；人物：/persons/{id}/subjects） */
    works: EntityWorkItem[];
    /** 出演角色（仅人物：/persons/{id}/characters） */
    characters?: EntityWorkItem[];
    /**
     * 职业（仅人物：/v0/persons/{id} 的 career，官方枚举 7 值：producer/mangaka/artist/seiyu/writer/illustrator/actor）。
     * 用于在人物简介区展示职业标签；含 seiyu 时人物卡隐藏「参与作品」（避免主题曲专辑/角色歌刷屏）。
     */
    career?: string[];
    /** 组织类型（仅人物：PersonType 1=个人 2=公司 3=组合，非性别），用于人物简介区展示（仅公司/组合有展示价值） */
    type?: number;
}
/**
 * 作品完整详情（点击角色卡的「出演作品」打开的卡片用）。
 * 复用详情页的四个共享组件（SubjectMetaPanel / SubjectCharacters / SubjectRelations / TucaoBox），
 * 因此 subject 字段需覆盖这些组件所需的全部可读字段（category / tags / meta / rating / 排名 / provider）。
 */
export interface SubjectFullSubject {
    id: number;
    provider: 'bangumi';
    providerSubjectId: string;
    category: Category;
    title: string;
    title_cn: string;
    image_url: string;
    summary: string;
    rating?: number;
    /** Bangumi 评分分布（1–10 星票数） */
    ratingCount?: number[];
    /** 评分总人数 */
    ratingTotal?: number;
    /** 站点排名文案，如 "#885" */
    rank?: string;
    tags: SubjectTag[];
    meta: SubjectMeta[];
    total_episodes?: number | null;
    total_volumes?: number | null;
    air_date?: string | null;
}
/** 单集（来自 Bangumi /episodes，正片 type=0）。epNumber 为 Bangumi 真实集号（可能非从 1 开始）。 */
export interface SubjectFullEpisode {
    id: number;
    epNumber: number;
    title: string | null;
    airDate: string | null;
    duration: string | null;
    epType: number;
}
export interface SubjectFullDetail {
    kind: 'subject';
    subject: SubjectFullSubject;
    /** 角色列表（含 CV 声优） */
    characters: SubjectCharacter[];
    /** 关联作品（前传 / 续集 / 外传 等） */
    relations: SubjectRelation[];
    /** 剧集（正片）。悬浮窗用其真实集号/标题/首播/时长渲染格子；缺失时格子按 total 兜底 */
    episodes?: SubjectFullEpisode[];
}
/** Bangumi 离线数据库（Archive）元信息 */
export interface ArchiveMeta {
    /** dump 文件名，如 dump-2026-08-04.210502Z.zip */
    version: string | null;
    /** 最新 dump 的 sha256（用于判断是否已是最新） */
    sha256: string | null;
    /** dump 体积（字节） */
    size: number | null;
    /** 导出日期 YYYY-MM-DD */
    date: string | null;
    /** 上次成功更新时间戳（ms） */
    lastSuccessAt: number | null;
    /** 上次失败信息 */
    lastError: string | null;
    /** 状态：ok / error / null（未初始化） */
    status: string | null;
    /** 离线库 schema 版本（变更入库字段时 +1，用于触发旧库重新入库） */
    schemaVersion: number | null;
}
/** 更新进度回调载荷 */
export interface ArchiveProgress {
    stage: 'start' | 'download' | 'extract' | 'ingest' | 'done' | 'error';
    /** 下载阶段：已下载字节 / 总字节 */
    downloaded?: number;
    total?: number;
    /** 入库阶段：当前表中文名 / 已处理行数 */
    table?: string;
    count?: number;
    message?: string;
}
/** 更新结果 */
export interface ArchiveUpdateResult {
    status: 'updated' | 'up-to-date' | 'error';
    version?: string;
    size?: number;
    date?: string;
    error?: string;
}
/** 离线搜索结果条目 */
export interface ArchiveSubjectSearch {
    id: number;
    /** Bangumi subject type（1=书籍 2=动画 4=游戏 6=三次元 …） */
    type: number;
    name: string;
    name_cn: string;
    score: number | null;
    summary: string;
}
/** 离线库按标签过滤返回的作品条目（含封面 url，用于标签作品悬浮窗） */
export interface ArchiveTagSubject {
    id: number;
    /** Bangumi subject type（1=书籍 2=动画 4=游戏 6=三次元 …） */
    type: number;
    /** 细分类目：anime / light_novel / manga / galgame / other（书籍按 Bangumi platform/tags 细分） */
    category: string;
    name: string;
    name_cn: string;
    score: number | null;
    /** Bangumi 榜单名次（越小越靠前，null=未上榜）；离线库直接可取 */
    rank: number | null;
    /** 放送/出版日期 YYYY-MM-DD（离线库直接可取） */
    date: string | null;
    summary: string;
    image_url: string;
}
export interface AuthStatus {
    loggedIn: boolean;
    username?: string;
    userId?: number;
    /** 令牌来源：oauth（应用授权登录）/ token（手动粘贴个人令牌） */
    method?: 'oauth' | 'token';
}
/** 同步结果（推送 / 拉取 / 双向） */
export interface SyncResult {
    pushed: number;
    pulled: number;
    failed: number;
    /** 因“云端已取消收藏”而被删除的本地收藏条数（Q1 差集删除） */
    deleted?: number;
    error?: string;
}
/** 动画详情（getDetail 返回）：作品 + 收藏 + 剧集 + 逐集进度 */
export interface AnimeDetail {
    subject: {
        id: number;
        provider_subject_id?: string;
        title: string;
        title_cn?: string;
        image_url?: string;
        total_episodes?: number | null;
        air_date?: string | null;
        rating?: number;
        /** 作品简介（Bangumi summary；本地缺失时联网/离线 Archive 兜底补取） */
        summary?: string;
        tags?: SubjectTag[];
        meta?: SubjectMeta[];
    };
    collection: {
        id: number;
        status: number;
        ep_status: number;
    } | null;
    episodes: {
        id: number;
        ep_number: number;
        ep_type: number;
        title?: string | null;
    }[];
    /** 真实剧集（Bangumi /episodes，正片）。仅用于显示增强：真实集号/标题/首播/时长。
     *  与上面的 episodes（本地库，含进度 id）按位置对应；获取失败时为空数组。 */
    bangumiEpisodes?: SubjectFullEpisode[];
    progress: Record<number, boolean>;
    /** 角色列表（Bangumi 角色，含 CV 声优） */
    characters: SubjectCharacter[];
    /** 关联作品（前传 / 续集 / 外传 等） */
    relations: SubjectRelation[];
}
/** 在看列表项 */
export interface AnimeWatchingItem {
    collectionId: number;
    subjectId: number;
    title: string;
    titleCn?: string;
    imageUrl?: string;
    epStatus: number;
    totalEpisodes?: number | null;
}
/** 动画统计 */
export interface AnimeStats {
    watching: number;
    watched: number;
}
/** 通用收藏详情（轻小说/漫画/Galgame 复用同一套 collections 仓储） */
export interface CollectionDetail {
    subject: {
        id: number;
        provider_subject_id?: string;
        title: string;
        title_cn?: string;
        image_url?: string;
        total_episodes?: number | null;
        total_volumes?: number | null;
        air_date?: string | null;
        rating?: number;
        summary?: string;
        tags?: SubjectTag[];
        meta?: SubjectMeta[];
    };
    collection: {
        id: number;
        status: number;
        ep_status: number;
    } | null;
    /** 角色列表（Bangumi 角色，含 CV 声优） */
    characters: SubjectCharacter[];
    /** 关联作品（前传 / 续集 / 外传 等） */
    relations: SubjectRelation[];
}
/** 收藏列表项（含当前进度 ep_status 与总量） */
export interface CollectionItem {
    collectionId: number;
    subjectId: number;
    title: string;
    titleCn?: string;
    imageUrl?: string;
    epStatus: number;
    totalVolumes?: number | null;
    totalEpisodes?: number | null;
}
/** 收藏统计（某分类下的在看部数 + 累计进度） */
export interface CollectionStats {
    watching: number;
    totalProgress: number;
}
/** 购买信息（Galgame 模块的购买平台与价格，仅本地存储） */
export interface Purchase {
    id?: number;
    collectionId: number;
    platform: string | null;
    price: number | null;
    currency: string;
    note?: string | null;
}
/** 通过 contextBridge 暴露给渲染进程的安全 API 形状 */
export interface AcgnApi {
    app: {
        getInfo: () => Promise<AppInfo>;
        openExternal: (url: string) => Promise<void>;
        relaunch: () => Promise<void>;
    };
    db: {
        query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
        run: (sql: string, params?: unknown[]) => Promise<{
            lastInsertRowid: number;
            changes: number;
        }>;
    };
    api: {
        /** 统一搜索：条目（动画/书籍/游戏）或人物（角色/现实），返回联合结果 SearchResultItem[] */
        search: (query: SearchQuery) => Promise<SearchResultItem[]>;
        /** 取 Galgame 的游戏画廊（复刻「游戏画廊」组件：VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组） */
        gallery: (subjectId: number, force?: boolean) => Promise<GameGallery>;
    };
    anime: {
        addToWatching: (subject: Subject) => Promise<{
            collectionId: number;
            subjectId: number;
        }>;
        getDetailLocal: (subjectId: number) => Promise<AnimeDetail>;
        getDetail: (subjectId: number) => Promise<AnimeDetail>;
        toggleEpisode: (collectionId: number, episodeId: number) => Promise<{
            watched: boolean;
            epStatus: number;
        }>;
        listWatching: (status?: number) => Promise<AnimeWatchingItem[]>;
        getStats: () => Promise<AnimeStats>;
    };
    collection: {
        add: (subject: Subject, status?: number) => Promise<{
            collectionId: number;
            subjectId: number;
        }>;
        detailLocal: (subjectId: number) => Promise<CollectionDetail>;
        detail: (subjectId: number) => Promise<CollectionDetail>;
        setProgress: (collectionId: number, value: number) => Promise<{
            epStatus: number;
        }>;
        setStatus: (collectionId: number, status: number) => Promise<{
            status: number;
        }>;
        /** 设置「我的评价」评分（1-10）并同步到 Bangumi；返回同步结果 */
        setRating: (providerSubjectId: string, rating: number) => Promise<{
            ok: boolean;
            synced: boolean;
            error?: string;
            collectionId: number;
        }>;
        list: (category: Category, status: number) => Promise<CollectionItem[]>;
        stats: (category: Category) => Promise<CollectionStats>;
        reclassifyBooks: () => Promise<{
            total: number;
            changed: number;
            lightNovel: number;
            manga: number;
            failed: number;
        }>;
    };
    subjectExtra: {
        /** 后台异步补全角色/CV/关联条目中文名时，主进程推送更新。payload 含 characters 与 relations */
        onCnUpdated: (cb: (payload: {
            subjectId: number;
            characters: any[];
            relations: any[];
        }) => void) => () => void;
        /** 简介优先补全时，主进程流式推送。payload 含 subjectId 与 summary */
        onSummaryUpdated: (cb: (payload: {
            subjectId: number;
            summary: string;
        }) => void) => () => void;
    };
    purchases: {
        get: (collectionId: number) => Promise<Purchase | null>;
        save: (collectionId: number, data: {
            platform?: string;
            price?: number;
            currency?: string;
            note?: string;
        }) => Promise<Purchase>;
        totalSpent: (category: Category) => Promise<number>;
    };
    auth: {
        getStatus: () => Promise<AuthStatus>;
        saveToken: (token: string) => Promise<void>;
        login: () => Promise<AuthStatus>;
        getAppCredentials: () => Promise<{
            appId: string;
            appSecret: string;
        }>;
        saveAppCredentials: (appId: string, secret: string) => Promise<void>;
        logout: () => Promise<void>;
    };
    sync: {
        pushAll: (opts?: { episodeMarks?: boolean }) => Promise<SyncResult>;
        pullAll: () => Promise<SyncResult>;
        pullAllFull: () => Promise<SyncResult>;
        syncAll: () => Promise<SyncResult>;
    };
    subject: {
        /** 取 Bangumi 条目吐槽区中其它用户的吐槽（next p1 /subjects/{id}/comments，匿名可访问） */
        getComments: (subjectId: string, offset?: number) => Promise<{
            comments: SubjectComment[];
            total: number;
        }>;
        /** 取角色/人物详情（替代跳转 bgm 网页）：kind='character'|'person'，匿名亦可访问 */
        getEntity: (kind: 'character' | 'person', id: number) => Promise<EntityDetail>;
        /**
         * 取作品完整详情（点击角色卡「出演作品」打开的卡片）：直接按 Bangumi 作品 id 联网拉取
         * subject + 角色 + 关联作品，匿名亦可访问。返回归一化的 SubjectFullDetail。
         * opts.withCn=false 时跳过角色/CV 中文名详情请求（首屏快开，中文名由 characters() 异步补）。
         */
        detailFull: (id: number, opts?: {
            withCn?: boolean;
        }) => Promise<SubjectFullDetail>;
        /**
         * 单独取角色列表（含中文名，用于悬浮窗首屏后异步补全，避免阻塞打开）。
         * 结构与 SubjectFullDetail.characters 一致（SubjectCharacter[]），供前端按 id 合并。
         */
        characters: (id: number) => Promise<SubjectCharacter[]>;
        /**
         * 取作品制作人员（staff）：作者 / 导演 / 原画 / 制作公司 等（Bangumi /subjects/{id}/persons，匿名可访问）。
         * 返回归一化的 SubjectPerson[]（含 id，供制作信息按名匹配后跳转人物卡）。
         * 不做额外中文名详情请求（省限流），name 直接用列表返回名。
         */
        persons: (id: number) => Promise<SubjectPerson[]>;
    };
    archive: {
        /** 读取离线库元信息（版本 / 日期 / 大小 / 上次更新时间 / 状态） */
        getMeta: () => Promise<ArchiveMeta | null>;
        /** 触发下载 + 校验 + 解压 + 入库（返回最终结果；进度经 onProgress 推送） */
        update: () => Promise<ArchiveUpdateResult>;
        /** 离线搜索全 Bangumi 条目（按名称） */
        search: (query: string, type?: number, limit?: number) => Promise<ArchiveSubjectSearch[]>;
        /** 离线库按标签过滤作品（秒显、无需联网） */
        searchByTag: (tag: string, limit?: number) => Promise<ArchiveTagSubject[]>;
        /** 订阅更新进度；返回取消订阅函数 */
        onProgress: (cb: (p: ArchiveProgress) => void) => () => void;
    };
    theme: {
        /** 截取当前窗口完整画面（旧主题真实外观，含卡片/边栏/文字），返回 PNG dataURL；
         *  供主题切换过渡遮罩使用；失败或无主窗口时返回 null */
        capture: () => Promise<string | null>;
        /** 同步原生窗口背景色（缩放窗口时露出的“窗口底色”需与内容背景一致，消除黑边/色差层） */
        setNativeBg: (color: string) => Promise<void>;
    };
    /** 个人中心：时间胶囊（操作历史）。数据来自 bgm.tv/user/{username}/timeline 只读 HTML 解析，
     *  因 Bangumi v0 无对应官方 API 端点，故为抓取解析，结构可能随网页改版变动。 */
    personal: {
        /** 拉取指定用户的时间胶囊动态（动作/封面/标题/时间/评论），支持分页。
         *  page 仅用于前端展示页码；实际翻页走 until 游标（p1 接口忽略 offset）。 */
        timeline: (username: string, page?: number, until?: string | null) => Promise<TimelinePage>;
    };
}
/** 时间胶囊里涉及的作品引用（单条目 1 个，多条目如「想读 X、Y 2 本书」为多个） */
export interface TimelineSubjectRef {
    /** 条目 ID */
    subjectId: number;
    /** 封面 URL（https://lain.bgm.tv/...） */
    cover?: string;
    /** 显示名（中文名优先） */
    title?: string;
    /** 原名 */
    subtitle?: string;
}
/** 时间胶囊单条动态（解析自 bgm.tv/user/{username}/timeline 的只读 HTML） */
export interface TimelineItem {
    /** 动态 id（tml_{id}） */
    id: string;
    /** 分组标题（时间线页面按日期分组的 h4.Header，如「今天」「昨天」「2026-8-9」） */
    group: string;
    /** 动作动词：在玩 / 看过 / 想看 / 完成了 / 在听 / 想听 / 读过 / 想读 / 在看 / 想玩 … */
    action: string;
    /** 首行完整文本：动作词 +（ep 标题 | 条目原名 | 多个条目名）。与 Bangumi 网页显示一致，
     *  如「看过 ep.4 燃灯与灰火」「读过 涼宮ハルヒ シリーズ」「想读 X、Y 2 本书」 */
    actionLine: string;
    /** 涉及的作品（单条目 1 个；多条目如「想读 X、Y 2 本书」为多个）。封面左右排列用此数组 */
    subjects: TimelineSubjectRef[];
    /** 主作品 ID（= subjects[0].subjectId），向后兼容 */
    subjectId: number;
    /** 主标题（= subjects[0].title），向后兼容 */
    title?: string;
    /** 原名（= subjects[0].subtitle），向后兼容 */
    subtitle?: string;
    /** 封面 URL（= subjects[0].cover），向后兼容 */
    cover?: string;
    /** 看过/在读某集时的单集信息：ep 链接文本，如「ep.4 燃灯与灰火」「第8话 …」 */
    episode?: string;
    /** 单集 ID（subject/ep/{id}），仅看/读单集时有 */
    episodeId?: number;
    /** 元信息行：话数 / 发售日 / 平台 / 制作等（来自 p.info.tip） */
    info?: string;
    /** 用户本人对该作品的评分（0-10，来自 rateInfo 的 starlight starsN）。
     *  仅「看过/读过/玩过/完成/在看/在玩…」等已收藏动作才有；「想看/想玩/想读」未评分无此值。
     *  渲染用金色。单集 / 多条目动态不显示评分，故为 undefined。 */
    myRating?: number;
    /** Bangumi 站点总评分（来自 rateInfo 的 fade，如 5.1）。渲染用灰色。 */
    siteRating?: number;
    /** 站点评分人数（来自 rate_total，如 199） */
    siteRatingCount?: number;
    /** 站点排名（来自 rank，如 #1） */
    rank?: string;
    /** 是否显示评分区：单集(episodeId)或多条目(subjects>1)为 false，其余为 true */
    showRating: boolean;
    /** 用户评论（可能为空） */
    comment?: string;
    /** 相对时间，如「2小时37分钟前」「13小时59分钟前」 */
    time: string;
    /** 绝对时间（title 属性），如「2026-8-10 16:01」 */
    timeAbs?: string;
    /** 来源：web / mobile / API（next 应用归为 API） */
    source?: string;
}
/** 时间胶囊单页数据（解析自 p1 /users/{username}/timeline 的 JSON 响应） */
export interface TimelinePage {
    /** 本页动态列表 */
    items: TimelineItem[];
    /** 当前页码（从 1 开始） */
    page: number;
    /** 是否有上一页 */
    hasPrev: boolean;
    /** 是否有下一页 */
    hasNext: boolean;
    /** 下一页游标：传给下次请求的 until 参数（p1 按动态 id 游标翻页）；无更多时为 null */
    nextUntil?: string | null;
}
