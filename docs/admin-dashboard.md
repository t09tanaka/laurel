# Nectar Admin Dashboard Design

この文書は Nectar のローカル Admin / dashboard 改善の設計メモです。
Ghost Admin と Ghost Editor は研究対象にするが、Nectar は
file-first / Markdown-first / static publishing の道具として設計する。
Ghost の CMS 機能を移植する文書ではない。

## North Star

Nectar Admin は "refined editorial workbench" かつ
"precise local publishing console" である。

- Markdown と Git 上のファイルを source of truth にする。
- Posts / Pages / Authors / Tags / Settings は実ファイルを中心に扱う。
- 変更検知、保存前 fingerprint、現在 fingerprint、ファイルパス、build freshness を
  画面上の主要情報にする。
- deploy しないと公開されない前提を守る。
- Preview は active theme で保存済み最新ファイルがどう見えるかを示す。
  未保存変更がある場合は、Preview が保存済み状態に基づくことを明示する。
- Email / newsletter / members / paid tiers は Admin 改善の対象外にする。
  Ghost 由来 frontmatter が存在しても破壊せず保持するだけに留める。

Ghost に勝つ領域は local files、sync safety、static build visibility、
schema-backed editing、Git awareness。勝たなくてよい領域は hosted multi-user SaaS、
membership billing、real-time analytics、email sending。

## Personas and Jobs

| Persona | Main jobs | Admin priority |
| --- | --- | --- |
| Solo writer | write, organize, preview, publish | 集中編集、下書き一覧、保存済み Preview、publish readiness |
| Developer-publisher | verify, build, fix, publish | file path、Git 状態、build/deploy 状態、diagnostics |
| Migration reviewer | migrate, verify, fix | Ghost import 差分、未知 frontmatter 保持、route preview |
| Theme builder | theme, preview, verify | active theme Preview、device/SEO/social preview、render diagnostics |
| Docs maintainer | write, organize, link-check | metadata editing、content health、bulk review |

機能追加は上の job に紐づかない限り優先しない。

## Information Architecture

Top-level navigation:

| Section | Purpose | Subviews |
| --- | --- | --- |
| Posts | 記事の作業台 | All, Drafts, Scheduled, Published |
| Pages | 固定ページの作業台 | All, Drafts, Published |
| Authors | `content/authors` の実体管理 | All, Missing metadata, Unused |
| Tags | `content/tags` と inferred tags の管理 | All, Described, Inferred, Unused |
| Settings | サイトと build 設定 | Site, Content paths, Theme, Build, Sync, Advanced |
| Sync | 外部編集と file-backed 状態 | Activity, Conflicts, Git, Build freshness |

Posts / Pages 一覧は作成日基準の pagination を持つ。検索、状態 filter、sort は
API foundation の後に段階導入する。左 nav は Ghost の高密度構造を参考にしつつ、
Nectar では file-backed state rail を常時表示する。

## Screen Contracts

### Dashboard Home

専用 Home は必須ではない。最初の安全な実装は Posts を初期表示にし、上部に
sync/build/preview の compact status を置く。Home を作る場合は marketing hero ではなく、
unpublished changes、recent file activity、build freshness、content health をまとめる
作業開始面に限定する。

### Lists

Posts / Pages / Authors / Tags は「読む一覧」ではなく編集作業台にする。

- primary columns: title, status, updated/created, route, file path, sync state。
- row action は edit、preview、open file、duplicate、more menu に分ける。
- status badge は Draft / Scheduled / Published / Dirty / External change /
  Conflict / Build stale を同じ体系で扱う。
- 長い日本語、長い slug、長い file path は折り返しまたは middle truncation で処理し、
  レイアウトを押し広げない。

### Settings

Settings は Ghost Admin X Settings の検索可能な構造を参考にする。ただし Nectar では
Site / Content paths / Theme / Build / Sync / Advanced に分け、設定値の出所を
`nectar.toml`、content directory、theme package、runtime state として明示する。

編集モードは inline edit、drawer、full-screen の 3 種を使い分ける。小さな値は inline、
複数 field と検証が必要な設定は drawer、content path や import/export など破壊的変更を
伴う操作は full-screen confirmation に寄せる。

### Sync

Nectar 固有価値は Ghost にはない双方向同期である。

- 保存前 fingerprint と現在 fingerprint を比較し、外部変更を上書きしない。
- conflict は toast だけに押し込まず、row badge、status rail、conflict panel に出す。
- Activity は file watcher、save、build、preview request、external edit を時系列で表示する。
- Git 状態は補助情報であり、Git 操作 UI の全面移植はしない。

## Editor Direction

Ghost Editor は Koenig / Lexical、title、excerpt、feature image、card insertion、
post settings、preview を統合した集中執筆画面として研究する。ただし Nectar は
Koenig / Lexical の内部データモデルを移植しない。

Nectar の責務境界:

| Area | Nectar contract |
| --- | --- |
| Body | Markdown text を保存する。将来の MDX / shortcode / card 補助も Markdown 上の明示構文にする。 |
| Metadata | YAML frontmatter を構造化 panel で編集し、未知 key は保持する。 |
| Preview | 保存済み最新ファイルを active theme で render する。未保存 live preview は公開状態の代替にしない。 |
| Save | fingerprint 照合後に書き込む。衝突時は overwrite しない。 |
| Build | static build freshness と diagnostics を editor から確認できるようにする。 |

Ghost から取り込む体験:

- title と本文に集中できる広い編集面。
- metadata / feature image / SEO / social preview を脇に置く post settings 感。
- card insertion の発見しやすさ。ただし Nectar では Markdown shortcode 補助として扱う。
- word count、reading time、publish readiness の軽量な feedback。

取り込まない機能:

- Koenig / Lexical の persisted JSON model。
- Ghost Admin autosave 前提の公開 workflow。
- newsletter/email preview、members-only delivery、paid tiers、billing。
- hosted multi-user collaboration、role/permission、staff invite。

## Visual and Brand Direction

Nectar のブランド語彙は files、sync、source、draft、publish、build、theme。
Ghost 風の汎用 CMS 語彙に寄せすぎず、ファイル編集と静的公開の状態がラベルと badge で
伝わる UI にする。説明文を読ませる UI にはしない。

Premium feel は主観ではなく、次の基準でレビューする。

- neutral foundation + sync green + conflict amber/red + file blue + editorial black。
- 1画面で主役になる色は neutral を除き 2 系統まで。
- 乱雑な gradient、単色テーマ、カード内カード、説明過多、低密度 hero、謎 icon を避ける。
- UI font は小さく締め、editor title と本文だけ余白を広く使う。
- viewport 幅連動の font-size は使わない。
- card radius は 8px 以下を基準にする。
- border と shadow は階層表現のためだけに使う。
- icon は既存 icon library を優先し、未知 icon には tooltip を付ける。

## Ghost Reference Board

Ghost 比較は好みではなく、画面単位の比較軸で扱う。

| Ghost screen | What to study | Nectar win condition |
| --- | --- | --- |
| Posts list | density, hierarchy, quick scanning | file path、sync state、route preview を追加しても密度を壊さない |
| Editor | focus, title/body rhythm, settings side menu | Markdown-first のまま集中感と metadata 安全性を両立する |
| Settings | searchable IA, grouped cards | config source と build/sync 影響を Ghost より明確にする |
| Design/Navigation | visual editing affordance | active theme と static output の関係を見失わせない |

Nectar 側 screenshot は同じ viewport で保存し、density、hierarchy、whitespace、
affordance、state visibility を記録してから実装判断する。

## Rollout Plan

巨大 PR を避ける。PR #504 の次フェーズは次の順で小さく進める。

1. API/test foundation: filter、search、sort、sync metadata、fingerprint 契約。
2. State model: dirty、external change、conflict、build stale、preview freshness。
3. Design tokens: palette、type scale、spacing、badge、button、list row。
4. Posts/Pages list UX: status subviews、pagination polish、route/file visibility。
5. Settings IA: searchable grouped cards、source labels、safe edit modes。
6. Sync/conflict UX: status rail、activity timeline、conflict recovery。
7. Editor focus mode: Markdown body、metadata panel、saved-theme preview。
8. Visual QA: Ghost comparison board、responsive、a11y、long text checks。

各 PR は単独でレビュー可能にし、scope、tests、visual evidence、Ghost 研究からの
判断、Nectar 固有価値を PR body に書く。`main` merge 後に新 branch を切る運用を基本にし、
ローカルだけで巨大な積み上げを作らない。

## Out of Scope

Admin 改善では次を実装しない。

- Email campaign creation、newsletter sending、email preview。
- Members signup/login backend、member analytics、paid tiers、billing。
- Hosted multi-user SaaS 管理、staff roles、permission matrix。
- Ghost Admin API / integrations directory の移植。

既存 content に Ghost 由来の `email_*`、newsletter、members、paid visibility などの
frontmatter がある場合は破壊せず保持する。UI は専用機能として扱わず、必要なら
unknown/frontmatter preservation として表示する。
