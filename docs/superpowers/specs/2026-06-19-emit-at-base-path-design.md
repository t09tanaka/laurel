# emit_at_base_path — ビルド成果物のディスク配置を公開URLツリーに揃える

- Date: 2026-06-19
- Status: Approved
- Scope: 本命のみ（deploy 側 prefix の次善案は対象外）

## 背景 / 課題

`build.base_path`（例 `/blog/`）は URL・canonical・og:url・sitemap・RSS・asset URL
には反映されるが、ビルド成果物のディスク配置には反映されない。結果、`base_path=/blog/`
でビルドしてもファイルは `dist/` 直下（`dist/index.html`, `dist/assets/…`）に出力され、
HTML 内 URL は `/blog/…` となり、ディスク構造と URL 構造が不一致になる。

このためサブパス配信（例 `attendar.com/blog`）のデプロイで「`--output dist/blog` で出して
親を sync」「sync 先に `/blog/` を付ける」「CloudFront で `/blog` を剥がす」等の手当てが
必要になり、プレフィックスの表現が複数箇所に散って事故の温床になる。

## ゴール

`base_path` を 1 個設定したら、URL・canonical・og・sitemap・RSS・**ディスク配置**が
すべてそれに揃い、ズレようがない状態にする。

`aws s3 sync dist s3://bucket` のように **親ディレクトリをそのまま転送**すれば、キー
`blog/…` が URL `/blog/…` と 1:1 になる。prefix ロジックも CloudFront の URI 書き換えも
不要。

## 設計判断（確定事項）

| 項目 | 決定 |
|------|------|
| スコープ | 本命のみ（`emit_at_base_path`）。deploy 側 prefix の次善案は実装しない |
| 既定値 | base_path 連動。`emit_at_base_path` 未指定かつ `base_path != "/"` なら true 扱い |
| GitHub Pages 連動 | 単純連動（GH Pages 由来の自動 base_path でも true）。特別扱いしない |

## アプローチ: `outputDir` 一点差し替え

全 emitter（48 箇所以上: HTML / assets / sitemap / RSS / robots / search / OG画像 /
content画像 / redirects / platform config / manifest / precompress / cleanup）は、書き込み先を
引数 `outputDir` から相対パスで決めている。`cleanupStaleOutput()` も `outputDir` 単位で動作し、
ビルドマニフェストも `outputDir` 配下に出る。`base_path` は URL 専用で FS パスには一切関与しない。

したがって **pipeline で実際の emit 先ディレクトリ（`emitDir`）を一度だけ算出し、それを以降の
`outputDir` として全 emitter に渡す**だけで、全成果物の書き込み先がまとめて追従する。route
相対パス・HTML 内 URL・sitemap・canonical は一切変更しない（URL は従来通り `/blog/…`）。

> 代替案（各 emitter で base_path を join する）は 48 箇所の改修＋付け忘れリスクが高く却下。

### アセットの扱い

アセット実体は同じ一点差し替えで自動追従する。HTML 内のアセット URL は既に base_path 付き
（`assetPublicUrl()` → `/blog/assets/built/screen-xxx.css`）で、実体は `copyAssets(outputDir, …)`
が `assets/…` を相対で書くため `emitDir` 配下 `dist/blog/assets/…` に落ちる。よって URL
`/blog/assets/…` ↔ ディスク `dist/blog/assets/…` が 1:1。**アセット用の追加処理は不要**。

## 実装

### 1. config schema（`src/config/schema.ts` の `[build]`）

```ts
emit_at_base_path: z
  .boolean()
  .optional()
  .describe(
    'When base_path is a subpath, emit the built site into output_dir/<base_path>/ so the on-disk tree mirrors the public URL tree. Defaults to true when base_path != "/" and unset.',
  ),
```

`.optional()`（**default 無し**）で 3 状態を表現する: 未指定 / 明示 true / 明示 false。

### 2. 実効値とディスクセグメントの算出（`src/build/pipeline.ts`）

`finalOutputDir` 算出と `normalizeBasePath()` 適用の後に:

```ts
const emit = config.build.emit_at_base_path ?? config.build.base_path !== '/';
const segment = basePathDiskSegment(config.build.base_path); // '/blog/' -> 'blog', '/ja/blog/' -> 'ja/blog', '/' -> ''
const emitDir = emit && segment !== '' ? join(finalOutputDir, segment) : finalOutputDir;
```

- `basePathDiskSegment()` は正規化済み base_path の先頭末尾スラッシュを除いた値を返す
  小ヘルパー（`src/build/base-path.ts` に追加、`normalizeBasePath` と同居）。
- 以降 `finalOutputDir` を渡していた箇所をすべて `emitDir` に置き換える（変数の意味だけ差し替え）。
- `assertWithinOutputDir` 系の境界チェックは `emitDir` 基準で自己整合する。

### 3. CLI（`src/cli/commands/build.ts`）

- `--emit-at-base-path` / `--no-emit-at-base-path` を追加し、config を override する。
- `--base-path /pr-42/` プレビューと併用で `dist/pr-42/…` に出力でき、そのパスでそのまま配信可能。
- `--output <dir>` はベースとして扱い、その配下にセグメントを掘る
  （`--output _deploy` + emit → `_deploy/blog/`）。

### 4. base_path 漏れバグの修正（同梱）

`src/build/portal-manifest.ts:61` の recommendations ディープリンクが base_path を通さず
`/recommendations/#all-recommendations` を root 絶対で固定出力している。`base_path=/blog/` では
`/blog/recommendations/` であるべきで、emit と無関係に現状でも壊れている既存バグ。
`joinPath(config.build.base_path, 'recommendations/#all-recommendations')` 相当に修正する。

これ以外のアセット/内部リンク URL（favicon / manifest / OG / content画像 / theme asset /
RSS / sitemap / search / JSON-LD / preload / portal runtime / pagination / card assets）は
base_path を正しく通しており、漏れなしを確認済み。

## テスト（`tests/build/` 中心）

1. `emit=true` × `base_path=/blog/` → `dist/blog/index.html`・`dist/blog/assets/…` に出力され、
   HTML 内 URL は `/blog/…` のまま、`/blog/` 抜け参照 0。
2. 連動: 未指定 × `/blog/` → emit、未指定 × `/` → 非 emit（dist 直下）、明示 `false` × `/blog/`
   → dist 直下、明示 `true` × `/` → dist 直下（セグメント空なので差し替え無し）。
3. ネスト `/ja/blog/` → `dist/ja/blog/`。
4. CLI `--emit-at-base-path` / `--no-emit-at-base-path` / `--base-path` 併用。
5. 回帰ガード: `base_path=/blog/` でビルドした出力（HTML / manifest / JSON / portal-manifest）を
   走査し、`/blog/` を通さない root 絶対のアセット/内部リンク参照が 0 件であることを検証。
   将来 base_path 抜けが再発したら CI で落ちる。
6. 既存の `base_path=/` ビルドの出力先が不変（後方互換の回帰）。

## 既知の制約（文書化）

- **GitHub Pages 二重化**: `GITHUB_PAGES=true` の自動 base_path（`/<repo>/`）でも emit 連動 true
  となり `dist/<repo>/` に出力される。Pages 側がさらに `/<repo>/` を付与するワークフローでは
  `/<repo>/<repo>/` に二重化する。回避は `emit_at_base_path = false` を明示すること。単純連動の
  設計判断による既知の制約。
- **deploy は本命の対象外**: 期待運用は「親 `dist` をそのまま sync」
  （`aws s3 sync dist s3://bucket` → キー `blog/…`）。deploy 側の prefix ロジック（次善案）は
  今回実装しない。
- `base_path = "/"` では全選択で従来通り（後方互換）。

## 非ゴール

- deploy ターゲット（s3 / r2 / rsync / GitHub Pages 等）への base_path/prefix 反映（次善案）。
- multi-locale ルーティング（既存方針通り 1 build = 1 locale）。
