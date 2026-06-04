# Laurel Admin Dashboard Design

この文書は Laurel のローカル Admin / dashboard 改善の設計メモです。
Ghost Admin と Ghost Editor は研究対象にするが、Laurel は
file-first / Markdown-first / static publishing の道具として設計する。
Ghost の CMS 機能を移植する文書ではない。

## North Star

Laurel Admin は "refined editorial workbench" かつ
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

Top-level navigation (sidebar) は意図的に 3 項目に絞る。Authors / Tags は
Settings 配下の Taxonomy サブビューとして再配置し、Sync は status rail で
常時可視化することで sidebar を圧迫させない。

| Section | Purpose | Subviews |
| --- | --- | --- |
| Posts | 記事の作業台 | All, Drafts, Scheduled, Published |
| Pages | 固定ページの作業台 | All, Drafts, Published |
| Settings | サイト、build、taxonomy の集約 | Site, Theme, Authors, Tags, Build, Sync, Advanced |

Authors / Tags は `/authors`、`/tags` の URL を維持しつつ、sidebar 上では
Settings 配下のサブナビ (`Settings > Site` / `Authors` / `Tags`) として現れる。
これにより既存リンクと bookmark を壊さず、IA は Ghost Admin の Site Settings
に近い密度感を保てる。

Posts / Pages 一覧は作成日基準の pagination を持つ。検索、状態 filter、sort は
API foundation の後に段階導入する。左 nav は Ghost の高密度構造を参考にしつつ、
Laurel では file-backed state rail を常時表示する。

## Screen Contracts

### Dashboard Home

専用 Home は持たない。`/` は Posts にリダイレクトし、sync/build/preview は
sidebar の status rail に常時表示する。各 view top には作業内容を直接示す
per-view header (kicker + 20px section title + 1 行 meta) だけを置き、巨大な
site title hero や 4 個並ぶ stats カードは作らない。これは Ghost Admin の
list-first density と note 系の calm typography を踏襲する判断で、画面の主役
を当該リストや Settings panel に渡すための制約として運用する。

### Lists

Posts / Pages / Authors / Tags は「読む一覧」ではなく編集作業台にする。

- primary columns: title, status, updated/created, route, file path, sync state。
- row action は edit、preview、open file、duplicate、more menu に分ける。
- status badge は Draft / Scheduled / Published / Dirty / External change /
  Conflict / Build stale を同じ体系で扱う。
- 長い日本語、長い slug、長い file path は折り返しまたは middle truncation で処理し、
  レイアウトを押し広げない。

### Settings

Settings は Ghost Admin X Settings の検索可能な構造を参考にする。ただし Laurel では
Site / Content paths / Theme / Build / Sync / Advanced に分け、設定値の出所を
`laurel.toml`、content directory、theme package、runtime state として明示する。

編集モードは inline edit、drawer、full-screen の 3 種を使い分ける。小さな値は inline、
複数 field と検証が必要な設定は drawer、content path や import/export など破壊的変更を
伴う操作は full-screen confirmation に寄せる。

### Sync

Laurel 固有価値は Ghost にはない双方向同期である。

- 保存前 fingerprint と現在 fingerprint を比較し、外部変更を上書きしない。
- conflict は toast だけに押し込まず、row badge、status rail、conflict panel に出す。
- Activity は file watcher、save、build、preview request、external edit を時系列で表示する。
- Git 状態は補助情報であり、Git 操作 UI の全面移植はしない。

## Editor Direction

Ghost Editor は Koenig / Lexical、title、excerpt、feature image、card insertion、
post settings、preview を統合した集中執筆画面として研究する。ただし Laurel は
Koenig / Lexical の内部データモデルを移植しない。

Laurel の責務境界:

| Area | Laurel contract |
| --- | --- |
| Body | Markdown text を保存する。将来の MDX / shortcode / card 補助も Markdown 上の明示構文にする。 |
| Metadata | YAML frontmatter を構造化 panel で編集し、未知 key は保持する。 |
| Preview | 保存済み最新ファイルを active theme で render する。未保存 live preview は公開状態の代替にしない。 |
| Save | fingerprint 照合後に書き込む。衝突時は overwrite しない。 |
| Build | static build freshness と diagnostics を editor から確認できるようにする。 |

Editor recovery の境界:

- Autosave でファイルへ書き込まない。未保存本文は `localStorage / sessionStorage` の draft として
  fingerprint と path 単位で保持し、保存成功時だけ削除する。
- 保存前 snapshot は browser local revisions として直近分だけ残す。rollback は editor へ復元するだけで、
  明示的な Save と fingerprint 照合を通るまで disk へ書かない。
- 外部編集で現在 fingerprint が変わった場合、古い fingerprint の draft は警告付きの復元候補として扱い、
  自動で現在ファイルを上書きしない。
- draft / revision は本文や frontmatter を含むため、機密情報をブラウザ storage に残すリスクがある。
  共有端末では手動削除や保存成功後の削除を前提にし、server-side history へ拡張する場合も明示的な opt-in にする。

Ghost から取り込む体験:

- title と本文に集中できる広い編集面。
- metadata / feature image / SEO / social preview を脇に置く post settings 感。
- card insertion の発見しやすさ。ただし Laurel では Markdown shortcode 補助として扱う。
- word count、reading time、publish readiness の軽量な feedback。

取り込まない機能:

- Koenig / Lexical の persisted JSON model。
- Ghost Admin autosave 前提の公開 workflow。
- newsletter/email preview、members-only delivery、paid tiers、billing。
- hosted multi-user collaboration、role/permission、staff invite。

## Visual and Brand Direction

Laurel のブランド語彙は files、sync、source、draft、publish、build、theme。
Ghost 風の汎用 CMS 語彙に寄せすぎず、ファイル編集と静的公開の状態がラベルと badge で
伝わる UI にする。説明文を読ませる UI にはしない。

Dashboard の具体的な色、typography、spacing、component styling は
[`admin-dashboard-design-system.md`](./admin-dashboard-design-system.md) を実装参照にする。
この design system は note.com の読書体験を参考にしつつ、Laurel の file-first dashboard へ
翻訳したものとして扱う。

Premium feel は主観ではなく、次の基準でレビューする。

- neutral foundation + sync green + conflict amber/red + file blue + editorial black。
- 1画面で主役になる色は neutral を除き 2 系統まで。
- 乱雑な gradient、単色テーマ、カード内カード、説明過多、低密度 hero、謎 icon を避ける。
- UI font は小さく締め、editor title と本文だけ余白を広く使う。
- viewport 幅連動の font-size は使わない。
- card radius は 8px 以下を基準にする。
- border と shadow は階層表現のためだけに使う。
- icon は既存 icon library を優先し、未知 icon には tooltip を付ける。

## Frontend Architecture Policy

Dashboard shell は `renderDashboardHtml()` を公開契約にし続ける。返す HTML は
`<div id="root"></div>` と `/assets/dashboard.js` / `/assets/dashboard.css` への
参照だけを持つ最小シェルで、UI 本体は **Preact + JSX** で書かれたバンドルが
クライアント側で `<div id="root">` にマウントする。`renderDashboardHtml()` の
契約 (CSP、token meta、skip link、`#root`) は変えない。

実装単位は `src/cli/dashboard/web/` 配下で次のように分割する。

- `entry.tsx` — Preact `render(<DashboardApp/>, root)` のマウント点
- `DashboardApp.tsx` — ルート、ルーティング、shell layout
- `components/` — `Sidebar` / `PageHeader` / `Toolbar` / `SettingsSubnav` /
  `ContentTable` / `TaxonomyView` / `SettingsView` / `CreateView` / `EditorView`
  / `StatePanel`
- `hooks/` — `useUiReducer` / `useEventStream`
- `lib/` — `api` (fetch wrappers) / `routes` (path 解決) / `format` (date,
  fingerprint) / `storage` (draft/revision/theme localStorage) / `view-head`
- `styles.css` — note 由来の design token と既存 component class を移植したもの

UI 状態は `useReducer` で `reduceDashboardUiState` を回し、純粋関数本体は
`src/cli/dashboard/ui-state.ts` (Preact 非依存) に置く。これにより DOM lib を
持たない CLI 側 tsconfig からも import でき、`bun test` で reducer を直接
ユニットテストできる。検索、status filter、posts/pages pagination、density、
theme、loading/error/conflict は同じ reducer の action として更新する。
Loading / Error / Conflict / Empty は `StatePanel` component を 1 系統だけ使う。

ビルドは `bun run build:dashboard-bundle` で `dist/dashboard-bundle/` に
`dashboard.js` (Preact + entry) と `dashboard.css` (token + component CSS) を
出力する。`prepublishOnly` 経由で npm パッケージにも同梱され、CLI 配布時に
ビルドステップを要求しない。dashboard サーバは `/assets/dashboard.{js,css}` を
`Bun.file` でストリーム配信し、バンドルが未生成の場合は明示的に
`Run \`bun run build:dashboard-bundle\` ...` のヒントを返す。

`tsc --noEmit` は 2 段で走る。`src/cli/dashboard/web/` は DOM lib が必要なので
専用 `tsconfig.json` を持ち、ルート tsconfig は web ディレクトリを exclude する。
biome の format/lint は両方をカバーする。

Dark mode は opt-in ではなく system preference を既定にする。手動 toggle は
`localStorage` に `system` / `light` / `dark` を保存するだけで、Laurel config や content file は
変更しない。テーマ token は最小限に留め、静的サイトの active theme とは別概念として扱う。

Iconography は dashboard 内で一貫した nav/toolbar の小さな icon surface に限定する。
追加の icon bundle は持たず、外部ライブラリを導入する場合は別タスクで bundle strategy と
アクセシビリティ label を同時に決める。

## I18n, Feature Flags, Telemetry

Admin UI copy は当面 English を fallback とする。サイト本文、frontmatter、`laurel.toml` の
`locale` は保持するが、CMS 的な翻訳管理 UI は作らない。i18n を入れる場合は file-backed な
Admin catalog を source of truth にし、実行時に外部 service から文言を取得しない。

Feature flag は local-only / file-first にする。必要になった場合は明示的な config または
dashboard state の settings surface に出し、remote rollout や hosted flag service は使わない。

Telemetry は dashboard から収集しない。Admin は local process が local files を扱う道具であり、
利用状況、content title、file path、編集イベントを外部送信しない。将来 opt-in telemetry を検討する
場合も、既定 off、送信内容の明示、file-first な設定、テスト可能な no-network 契約を必須にする。

## Ghost Reference Board

Ghost 比較は好みではなく、画面単位の比較軸で扱う。

| Ghost screen | What to study | Laurel win condition |
| --- | --- | --- |
| Posts list | density, hierarchy, quick scanning | file path、sync state、route preview を追加しても密度を壊さない |
| Editor | focus, title/body rhythm, settings side menu | Markdown-first のまま集中感と metadata 安全性を両立する |
| Settings | searchable IA, grouped cards | config source と build/sync 影響を Ghost より明確にする |
| Design/Navigation | visual editing affordance | active theme と static output の関係を見失わせない |

Laurel 側 screenshot は同じ viewport で保存し、density、hierarchy、whitespace、
affordance、state visibility を記録してから実装判断する。

## Executable Visual QA

Dashboard visual QA は Browser plugin に依存しない。CI/local では Bun script が
dashboard server を一時起動し、HTML/API smoke を通したうえで Chrome DevTools Protocol
から screenshot と HTML snapshot を保存する。Browser plugin が使える場合は同じ URL を
開いて目視確認してよいが、必須の実行経路にはしない。

標準コマンド:

- `bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project`
- `bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project --smoke-only`
- `bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project --dry-run`

出力先は既定で `.laurel/dashboard-visual-qa`。この directory は git 管理外で、
`smoke.json`、`plan.json`、`<viewport>-<screen>.png`、`<viewport>-<screen>.html` を
保存する。fixture は出力先の `.work/project` にコピーしてから使うため、Conflict 画面の
外部変更再現で `tests/fixtures/dashboard-visual-project` は変更しない。server と Chrome は
script の `finally` で停止する。

対象 viewport:

| Viewport | Size | Purpose |
| --- | --- | --- |
| desktop | 1440x1100 | Ghost Admin desktop baseline と比較する |
| laptop | 1280x900 | 一般的な作業 laptop で密度と折り返しを見る |
| mobile | 390x844 | 狭幅 nav、toolbar、table scroll、editor drawer を見る |

対象画面は Posts / Pages / Settings / Editor / Conflict / Empty。Posts と Pages は一覧密度、
Settings は card grouping、Editor は Markdown-first の集中感、Conflict は fingerprint
保護の可視性、Empty は検索結果ゼロ時の余白と行動導線を見る。

Ghost comparison pass line:

- Ghost の模倣ではなく、file path、sync state、build/source 情報が自然に読める。
- title/path/status/date が desktop/laptop/mobile で重ならず、長い日本語と slug が折り返す。
- Posts / Pages / Settings / Editor / Conflict / Empty の主要操作が viewport 変更で消えない。
- 色は neutral foundation を主役にし、sync green、conflict amber/red、file blue を状態表示に限定する。
- card 内 card、過剰な gradient、説明過多の hero、viewport 幅連動 font-size を使わない。
- Editor は Ghost の集中感を参考にするが、保存済み Preview と fingerprint safety を
  Laurel 固有価値として Ghost より明確にする。

Fallback 手順:

1. Browser plugin が使える場合は script の smoke URL または dashboard URL を開いて追加確認する。
2. Browser plugin がない場合は標準 script の Chrome DevTools Protocol capture を使う。
3. Chrome/Chromium が見つからない CI では `--smoke-only` で HTML/API smoke と docs/test を通し、
   visual artifact は Chrome がある local runner で作る。
4. Chrome の場所が標準検出できない場合は `LAUREL_CHROME_PATH=/path/to/chrome` を指定する。

Screenshot regression は現時点では強制 pixel gate にしない。OS font、Chrome version、
antialiasing の差分で不安定になりやすいため、まず review artifact と checklist を gate にする。
pixel comparison を導入する場合は Docker image、font、viewport、threshold を固定してから
別 PR で CI 必須化する。

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
判断、Laurel 固有価値を PR body に書く。`main` merge 後に新 branch を切る運用を基本にし、
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
