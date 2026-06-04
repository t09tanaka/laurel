# Entry Zip Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON `page-bundle` with a kind-aware (posts + pages) **zip** bundle that exports an entry as "send for review" (stamping `status: needs-review`) and imports it back (overwrite-on-collision, landing as needs-review), giving dashboard-only editors a review handoff with no server.

**Architecture:** One zip codec (`createZipArchive` writer + `readZipArchive` reader in `zip-writer.ts`) underpins a rewritten `src/entry-bundle/` module that resolves entries by `kind` against `posts_dir`/`pages_dir`, reuses the proven asset-collection / path-safety / conflict logic from the deleted page-bundle, and carries a `laurel-bundle.json` manifest. Workflow state lives in frontmatter `status`; the build already emits only `published`, so `needs-review` is excluded for free. Dashboard endpoints, CLI commands, client API, and `ContentTable` UI migrate to the new system.

**Tech Stack:** Bun, TypeScript (strict, no `any`), Zod (frontmatter schema), `node:zlib` deflateRaw/inflateRaw, React (dashboard web), bun test, Biome.

---

## Spec

Design: `docs/superpowers/specs/2026-05-29-post-zip-handoff-design.md` (Revision 2).

## File Structure

**Create:**
- `src/entry-bundle/index.ts` — kind-aware zip `EntryBundle` codec (export/import). Replaces `src/page-bundle/index.ts`.
- `src/entry-bundle/zip.ts` — in-memory zip reader (`readZipArchive`). Co-located with the bundle that consumes it.
- `tests/entry-bundle/index.test.ts` — codec + import/export tests.
- `tests/entry-bundle/zip.test.ts` — zip writer/reader round-trip.

**Modify:**
- `src/content/frontmatter-schema.ts:3-4` — add `needs-review`, `approved` to status enums.
- `src/cli/dashboard/zip-writer.ts` — add in-memory `createZipArchive(entries)` (refactor shared header builders out of `createDistZipStream`).
- `src/content/loader.ts:336,410` — exclusion predicate: "not published" instead of "is draft".
- `src/cli/commands/dashboard.ts:1748-1797` + export wiring — replace `/api/page-bundles/*` with `/api/bundles/export` + `/api/bundles/import`.
- `src/cli/commands/export.ts`, `src/cli/commands/import.ts` — repoint CLI to entry-bundle.
- `src/cli/specs.ts`, `src/cli/dashboard/bundled-assets.ts` — update any page-bundle references.
- `src/cli/dashboard/web/lib/api.ts:604` — replace `exportPageBundle` with zip download + `importBundle`.
- `src/cli/dashboard/web/components/ContentTable.tsx:314` — export button (posts + pages), import UI, confirm dialog, status column, needs-review filter.

**Delete:**
- `src/page-bundle/index.ts`, `tests/page-bundle/index.test.ts` (after migration).

---

### Task 1: Add workflow status values to the frontmatter schema

**Files:**
- Modify: `src/content/frontmatter-schema.ts:3-4`
- Test: `tests/content/frontmatter-schema.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/content/frontmatter-schema.test.ts
import { describe, expect, test } from 'bun:test';
import { frontmatterStatusValues, pageFrontmatterStatusValues } from '~/content/frontmatter-schema.ts';

describe('workflow status values', () => {
  test('posts accept needs-review and approved', () => {
    expect(frontmatterStatusValues).toContain('needs-review');
    expect(frontmatterStatusValues).toContain('approved');
  });
  test('pages accept needs-review and approved', () => {
    expect(pageFrontmatterStatusValues).toContain('needs-review');
    expect(pageFrontmatterStatusValues).toContain('approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/content/frontmatter-schema.test.ts`
Expected: FAIL — arrays do not contain `needs-review`.

- [ ] **Step 3: Edit the enums**

```typescript
// src/content/frontmatter-schema.ts:3-4
export const frontmatterStatusValues = [
  'published',
  'draft',
  'scheduled',
  'needs-review',
  'approved',
] as const;
export const pageFrontmatterStatusValues = ['published', 'draft', 'needs-review', 'approved'] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/content/frontmatter-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/frontmatter-schema.ts tests/content/frontmatter-schema.test.ts
git commit -m "feat(content): add needs-review and approved frontmatter status"
```

---

### Task 2: Exclude all non-published statuses from the build

The build already filters to `status === 'published'` in the pipeline, but the loader's early-skip predicate (`loader.ts:336,410`) keys on `status === 'draft'`. `needs-review`/`approved` entries would otherwise be loaded and only filtered later (or surface in places that do not re-filter). Make the loader skip everything that is not `published` (when drafts are not requested), so the gate is uniform.

**Files:**
- Modify: `src/content/loader.ts:336,410`
- Test: `tests/content/loader.test.ts` (add a case; create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/content/loader.test.ts — add inside the existing describe, or create the file
import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent } from '~/content/loader.ts'; // confirm exported entry point name

async function fixture(status: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-loader-'));
  await mkdir(join(dir, 'content', 'posts'), { recursive: true });
  await writeFile(
    join(dir, 'content', 'posts', 'p.md'),
    `---\ntitle: P\nstatus: ${status}\n---\n\nbody\n`,
    'utf8',
  );
  return dir;
}

describe('loader publish gate', () => {
  test('needs-review posts are excluded when drafts are not included', async () => {
    const dir = await fixture('needs-review');
    const result = await loadContent({ cwd: dir, includeDrafts: false }); // match real signature
    expect(result.posts.find((p) => p.slug === 'p')).toBeUndefined();
  });
  test('published posts are included', async () => {
    const dir = await fixture('published');
    const result = await loadContent({ cwd: dir, includeDrafts: false });
    expect(result.posts.find((p) => p.slug === 'p')).toBeDefined();
  });
});
```

> Note: confirm the real loader entry point and options shape before running (the explore notes `loadContent`/`loadPagesWithApprovalGate`). Adjust the import and call to the actual signature; the assertion logic stays the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/content/loader.test.ts`
Expected: FAIL — `needs-review` post is currently included.

- [ ] **Step 3: Change the predicate at both sites (loader.ts:336 and :410)**

```typescript
// before:
if (raw.status === 'draft' && !includeDrafts) continue;
// after:
if (raw.status !== 'published' && !includeDrafts) continue;
```

Apply the same change at both line 336 and line 410. (`scheduled` handling, if any, lives downstream; this gate only governs the not-published early skip. If a separate scheduled path exists, leave it and confirm scheduled is still surfaced where intended.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/content/loader.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run the broader loader + build suite for regressions**

Run: `bun test tests/content tests/build`
Expected: PASS. If a previously-`scheduled` test breaks, reconcile by special-casing `scheduled` in the predicate (`status !== 'published' && status !== 'scheduled' && !includeDrafts`).

- [ ] **Step 6: Commit**

```bash
git add src/content/loader.ts tests/content/loader.test.ts
git commit -m "feat(content): exclude all non-published statuses from default build"
```

---

### Task 3: In-memory zip writer

Refactor `zip-writer.ts` so the header/CRC/deflate logic is shared, and add `createZipArchive(entries)` that builds a complete zip in memory from explicit `{ path, bytes }` entries (the existing `createDistZipStream` walks a directory; keep it, but route both through shared builders).

**Files:**
- Modify: `src/cli/dashboard/zip-writer.ts`
- Test: `tests/entry-bundle/zip.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/entry-bundle/zip.test.ts
import { describe, expect, test } from 'bun:test';
import { createZipArchive } from '~/cli/dashboard/zip-writer.ts';

describe('createZipArchive', () => {
  test('produces a zip with EOCD signature and the right entry count', () => {
    const enc = new TextEncoder();
    const zip = createZipArchive([
      { path: 'entry.md', bytes: enc.encode('hello') },
      { path: 'assets/images/a.txt', bytes: enc.encode('asset') },
    ]);
    // EOCD signature 0x06054b50 appears in the last 22 bytes.
    const tail = zip.subarray(zip.length - 22);
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(10, true)).toBe(2); // total entries
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/zip.test.ts`
Expected: FAIL — `createZipArchive` is not exported.

- [ ] **Step 3: Add `createZipArchive` to `zip-writer.ts`**

Add below the existing header helpers (which already exist: `makeLocalHeader`, `makeCentralHeader`, `makeEocd`, `crc32`, and `deflateRawSync` is imported):

```typescript
// src/cli/dashboard/zip-writer.ts
export interface ZipInputEntry {
  path: string;
  bytes: Uint8Array;
}

export function createZipArchive(inputs: ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const input of inputs) {
    const crc = crc32(input.bytes);
    const compressed = deflateRawSync(input.bytes);
    const useDeflate = compressed.length < input.bytes.length;
    const payload = useDeflate
      ? new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength)
      : input.bytes;
    const entry: ZipEntry = {
      pathBytes: encoder.encode(input.path),
      crc,
      compressedSize: payload.length,
      uncompressedSize: input.bytes.length,
      method: useDeflate ? 8 : 0,
      localHeaderOffset: offset,
    };
    const local = makeLocalHeader(entry);
    chunks.push(local, payload);
    offset += local.length + payload.length;
    entries.push(entry);
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of entries) {
    const central = makeCentralHeader(entry);
    chunks.push(central);
    centralSize += central.length;
  }
  chunks.push(makeEocd(entries.length, centralSize, centralOffset));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/zip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/zip-writer.ts tests/entry-bundle/zip.test.ts
git commit -m "feat(dashboard): add in-memory createZipArchive builder"
```

---

### Task 4: Zip reader

**Files:**
- Create: `src/entry-bundle/zip.ts`
- Test: `tests/entry-bundle/zip.test.ts` (extend)

- [ ] **Step 1: Write the failing round-trip test**

```typescript
// tests/entry-bundle/zip.test.ts — add
import { readZipArchive } from '~/entry-bundle/zip.ts';

describe('readZipArchive', () => {
  test('round-trips entries written by createZipArchive', () => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const zip = createZipArchive([
      { path: 'entry.md', bytes: enc.encode('hello world') },
      { path: 'assets/images/a.bin', bytes: new Uint8Array([0, 1, 2, 255, 254]) },
    ]);
    const entries = readZipArchive(zip);
    expect(entries.map((e) => e.path).sort()).toEqual(['assets/images/a.bin', 'entry.md']);
    const md = entries.find((e) => e.path === 'entry.md');
    expect(dec.decode(md?.bytes)).toBe('hello world');
    const bin = entries.find((e) => e.path === 'assets/images/a.bin');
    expect(Array.from(bin?.bytes ?? [])).toEqual([0, 1, 2, 255, 254]);
  });

  test('rejects a buffer with no EOCD', () => {
    expect(() => readZipArchive(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/zip.test.ts`
Expected: FAIL — `~/entry-bundle/zip.ts` does not exist.

- [ ] **Step 3: Implement the reader**

```typescript
// src/entry-bundle/zip.ts
import { inflateRawSync } from 'node:zlib';

export interface ZipFileEntry {
  path: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export function readZipArchive(data: Uint8Array): ZipFileEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data, view);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory offset
  const decoder = new TextDecoder();
  const entries: ZipFileEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CEN_SIG) {
      throw new Error('Invalid zip: bad central directory header');
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    entries.push({ path: name, bytes: readLocal(data, view, localOffset, method, compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(data: Uint8Array, view: DataView): number {
  // EOCD is 22 bytes + up to 65535 comment bytes; scan backward.
  const min = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('Invalid zip: end of central directory not found');
}

function readLocal(
  data: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error('Invalid zip: bad local file header');
  }
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  const payload = data.subarray(start, start + compSize);
  if (method === 0) return new Uint8Array(payload); // stored
  if (method === 8) {
    const out = inflateRawSync(payload);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  throw new Error(`Invalid zip: unsupported compression method ${method}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/zip.test.ts`
Expected: PASS (round-trip + reject).

- [ ] **Step 5: Commit**

```bash
git add src/entry-bundle/zip.ts tests/entry-bundle/zip.test.ts
git commit -m "feat(entry-bundle): add zip reader"
```

---

### Task 5: EntryBundle types + manifest + zip parse/validate

Port the page-bundle helpers (`collectBundleAssets`, `assetRelFromReference`, `collectBodyAssetReferences`, `collectStringValues`, `resolveImportTarget`, `validateWritableBundlePaths`, `assertWritablePathHasNoSymlink`, `safeSlug`, `isSafeRelativePath`, `isInsidePath`, etc.) into `src/entry-bundle/index.ts`, generalized over `kind`. This task defines types + manifest + the zip→bundle parser with validation.

**Files:**
- Create: `src/entry-bundle/index.ts`
- Test: `tests/entry-bundle/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/entry-bundle/index.test.ts
import { describe, expect, test } from 'bun:test';
import { createZipArchive } from '~/cli/dashboard/zip-writer.ts';
import { parseEntryBundleZip, BUNDLE_SCHEMA } from '~/entry-bundle/index.ts';

const enc = new TextEncoder();

function makeZip(manifest: unknown, md: string, assets: { path: string; bytes: Uint8Array }[] = []) {
  return createZipArchive([
    { path: 'laurel-bundle.json', bytes: enc.encode(JSON.stringify(manifest)) },
    { path: 'entry.md', bytes: enc.encode(md) },
    ...assets,
  ]);
}

describe('parseEntryBundleZip', () => {
  test('parses a valid post bundle', () => {
    const zip = makeZip(
      { schema: BUNDLE_SCHEMA, kind: 'post', slug: 'hello', path: 'content/posts/hello.md', generated_at: '2026-01-01T00:00:00Z' },
      '---\ntitle: Hello\nstatus: needs-review\n---\n\nbody\n',
    );
    const bundle = parseEntryBundleZip(zip);
    expect(bundle.kind).toBe('post');
    expect(bundle.slug).toBe('hello');
    expect(bundle.frontmatter.status).toBe('needs-review');
  });

  test('rejects a zip without a manifest', () => {
    const zip = createZipArchive([{ path: 'entry.md', bytes: enc.encode('---\ntitle: x\n---\n') }]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/manifest/i);
  });

  test('rejects a zip-slip asset path', () => {
    const zip = makeZip(
      { schema: BUNDLE_SCHEMA, kind: 'post', slug: 'h', path: 'content/posts/h.md', generated_at: '2026-01-01T00:00:00Z' },
      '---\ntitle: H\n---\n\nb\n',
      [{ path: '../../etc/evil', bytes: enc.encode('x') }],
    );
    expect(() => parseEntryBundleZip(zip)).toThrow(/path/i);
  });

  test('rejects an unknown schema', () => {
    const zip = makeZip(
      { schema: 'laurel.page.v1', kind: 'post', slug: 'h', path: 'x', generated_at: 'x' },
      '---\ntitle: H\n---\n',
    );
    expect(() => parseEntryBundleZip(zip)).toThrow(/schema/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/index.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement types, manifest, and parser**

```typescript
// src/entry-bundle/index.ts (part 1 — parsing/validation; export/import added in later tasks)
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { readZipArchive, type ZipFileEntry } from './zip.ts';

export const BUNDLE_SCHEMA = 'laurel.bundle.v1';
export type EntryKind = 'post' | 'page';

export interface EntryBundleManifest {
  schema: typeof BUNDLE_SCHEMA;
  kind: EntryKind;
  slug: string;
  path: string;
  site?: { title: string; url: string };
  generated_at: string;
  generator_version?: string;
}

export interface ParsedEntryBundle {
  kind: EntryKind;
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  assets: ZipFileEntry[]; // paths under "assets/"
  manifest: EntryBundleManifest;
}

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export function parseEntryBundleZip(zip: Uint8Array): ParsedEntryBundle {
  const entries = readZipArchive(zip);
  if (entries.length > MAX_ENTRIES) throw new Error('Bundle has too many entries');
  const total = entries.reduce((n, e) => n + e.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('Bundle is too large');

  const manifestEntry = entries.find((e) => e.path === 'laurel-bundle.json');
  if (!manifestEntry) throw new Error('Invalid bundle: missing laurel-bundle.json manifest');
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestEntry.bytes)));

  const mdEntry = entries.find((e) => e.path === 'entry.md');
  if (!mdEntry) throw new Error('Invalid bundle: missing entry.md');
  const parsed = parseFrontmatter(new TextDecoder().decode(mdEntry.bytes), {
    filePath: manifest.path,
  });

  const assets: ZipFileEntry[] = [];
  for (const entry of entries) {
    if (entry.path === 'laurel-bundle.json' || entry.path === 'entry.md') continue;
    if (!entry.path.startsWith('assets/')) {
      throw new Error(`Invalid bundle: unexpected entry path ${entry.path}`);
    }
    if (!isSafeRelativePath(entry.path)) {
      throw new Error(`Invalid bundle: unsafe asset path ${entry.path}`);
    }
    assets.push(entry);
  }

  return {
    kind: manifest.kind,
    slug: manifest.slug,
    path: manifest.path,
    frontmatter: parsed.data,
    body: parsed.body,
    assets,
    manifest,
  };
}

function parseManifest(value: unknown): EntryBundleManifest {
  if (!isRecord(value)) throw new Error('Invalid bundle: manifest must be an object');
  if (value.schema !== BUNDLE_SCHEMA) {
    throw new Error(`Invalid bundle: expected schema ${BUNDLE_SCHEMA}`);
  }
  if (value.kind !== 'post' && value.kind !== 'page') {
    throw new Error('Invalid bundle: kind must be "post" or "page"');
  }
  if (typeof value.slug !== 'string' || typeof value.path !== 'string') {
    throw new Error('Invalid bundle: slug and path are required');
  }
  return {
    schema: BUNDLE_SCHEMA,
    kind: value.kind,
    slug: value.slug,
    path: value.path,
    generated_at: typeof value.generated_at === 'string' ? value.generated_at : new Date(0).toISOString(),
    site: isRecord(value.site)
      ? { title: String(value.site.title ?? ''), url: String(value.site.url ?? '') }
      : undefined,
    generator_version: typeof value.generator_version === 'string' ? value.generator_version : undefined,
  };
}

// Ported verbatim from the deleted src/page-bundle/index.ts:
export function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('\\') &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
```

> When porting, copy `isSafeRelativePath`'s original body but allow the `assets/` prefix path form used here (the original rejected absolute paths via `isAbsolute`; for zip-internal forward-slash paths the `..`/empty-part check is what matters). Keep the original `assetRelFromReference`, `collectStringValues`, `collectBodyAssetReferences` for the export task — copy them now into this file so later tasks can use them.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/index.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/entry-bundle/index.ts tests/entry-bundle/index.test.ts
git commit -m "feat(entry-bundle): parse and validate zip bundles"
```

---

### Task 6: Export an entry to a zip (stamps needs-review)

**Files:**
- Modify: `src/entry-bundle/index.ts`
- Test: `tests/entry-bundle/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/entry-bundle/index.test.ts — add
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportEntryBundle } from '~/entry-bundle/index.ts';
import { readZipArchive } from '~/entry-bundle/zip.ts';

// Minimal config matching LaurelConfig content + site fields used by export.
function cfg() {
  return {
    site: { title: 'T', url: 'https://e.example' },
    content: { posts_dir: 'content/posts', pages_dir: 'content/pages', assets_dir: 'content/images' },
  } as unknown as import('~/config/schema.ts').LaurelConfig;
}

describe('exportEntryBundle', () => {
  test('bundles a post and stamps needs-review on the copy in the zip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-export-'));
    await mkdir(join(dir, 'content', 'posts'), { recursive: true });
    await writeFile(
      join(dir, 'content', 'posts', 'hello.md'),
      '---\ntitle: Hello\nstatus: draft\n---\n\nbody\n',
      'utf8',
    );
    const { zip } = await exportEntryBundle({ cwd: dir, config: cfg(), kind: 'post', slug: 'hello' });
    const entries = readZipArchive(zip);
    const md = new TextDecoder().decode(entries.find((e) => e.path === 'entry.md')?.bytes);
    expect(md).toMatch(/status:\s*needs-review/);
    expect(entries.some((e) => e.path === 'laurel-bundle.json')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/index.test.ts -t exportEntryBundle`
Expected: FAIL — `exportEntryBundle` not exported.

- [ ] **Step 3: Implement `exportEntryBundle`**

```typescript
// src/entry-bundle/index.ts — add
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { absolutise, resolveContentSlugPath } from '~/cli/content-paths.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import { formatContentSource } from '~/content/format.ts';
import { createZipArchive, type ZipInputEntry } from '~/cli/dashboard/zip-writer.ts';
// plus the ported collectBundleAssets / assetRelFromReference helpers (see Task 5 note)

function entryRoot(cwd: string, config: LaurelConfig, kind: EntryKind): string {
  return absolutise(cwd, kind === 'post' ? config.content.posts_dir : config.content.pages_dir);
}

export async function exportEntryBundle({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: LaurelConfig;
  kind: EntryKind;
  slug: string;
}): Promise<{ zip: Uint8Array; omittedAssets: string[] }> {
  const root = entryRoot(cwd, config, kind);
  const resolved = await resolveContentSlugPath(slug, [kind === 'post' ? 'posts' : 'pages'], {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  });
  if (!resolved) throw new Error(`${kind} not found: ${slug}`);

  const raw = await readFile(resolved.path, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath: resolved.path });
  const frontmatter = { ...parsed.data, status: 'needs-review' };

  const { assets, omitted } = await collectBundleAssets({
    cwd,
    config,
    frontmatter,
    body: parsed.body,
  });

  const manifest: EntryBundleManifest = {
    schema: BUNDLE_SCHEMA,
    kind,
    slug,
    path: relative(cwd, resolved.path).split(sep).join('/'),
    site: { title: config.site.title, url: config.site.url },
    generated_at: new Date().toISOString(),
  };

  const entryMd = serializeEntryMarkdown(frontmatter, parsed.body, resolved.path);
  const zipInputs: ZipInputEntry[] = [
    { path: 'laurel-bundle.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { path: 'entry.md', bytes: new TextEncoder().encode(entryMd) },
    ...assets.map((a) => ({ path: `assets/${a.rel}`, bytes: a.bytes })),
  ];
  return { zip: createZipArchive(zipInputs), omittedAssets: omitted };
}

function serializeEntryMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string,
): string {
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  return formatContentSource(
    `---\n${JSON.stringify(frontmatter)}\n---\n${normalizedBody.startsWith('\n') ? normalizedBody : `\n${normalizedBody}`}`,
    { filePath },
  );
}
```

> Port `collectBundleAssets` from the old page-bundle but change its return to `{ assets: { rel: string; bytes: Uint8Array }[]; omitted: string[] }` (read raw bytes, not base64; record references that resolved to a path but were missing/not-a-file as `omitted`). `rel` is the path relative to `assets_dir`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/index.test.ts -t exportEntryBundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entry-bundle/index.ts tests/entry-bundle/index.test.ts
git commit -m "feat(entry-bundle): export an entry to a zip and stamp needs-review"
```

---

### Task 7: Import an entry from a zip (overwrite on collision, lands needs-review)

**Files:**
- Modify: `src/entry-bundle/index.ts`
- Test: `tests/entry-bundle/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/entry-bundle/index.test.ts — add
import { importEntryBundle } from '~/entry-bundle/index.ts';

describe('importEntryBundle', () => {
  test('overwrites an existing post and keeps needs-review', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-import-'));
    await mkdir(join(dir, 'content', 'posts'), { recursive: true });
    await writeFile(join(dir, 'content', 'posts', 'hello.md'), '---\ntitle: Old\nstatus: published\n---\n\nold\n', 'utf8');

    // build a bundle from a freshly exported source
    await writeFile(join(dir, 'content', 'posts', 'src.md'), '---\ntitle: New\nstatus: draft\n---\n\nnew\n', 'utf8');
    const { zip } = await exportEntryBundle({ cwd: dir, config: cfg(), kind: 'post', slug: 'src' });
    // re-point the manifest slug to "hello" by re-parsing + re-exporting is overkill; import as-is then assert on the imported slug
    const result = await importEntryBundle({ cwd: dir, config: cfg(), zip, onConflict: 'overwrite' });
    expect(result.written).toBe(true);
    const written = await readFile(join(dir, 'content', 'posts', `${result.slug}.md`), 'utf8');
    expect(written).toMatch(/status:\s*needs-review/);
  });

  test('dryRun writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-import-dry-'));
    await mkdir(join(dir, 'content', 'posts'), { recursive: true });
    await writeFile(join(dir, 'content', 'posts', 'src.md'), '---\ntitle: New\n---\n\nnew\n', 'utf8');
    const { zip } = await exportEntryBundle({ cwd: dir, config: cfg(), kind: 'post', slug: 'src' });
    const result = await importEntryBundle({ cwd: dir, config: cfg(), zip, onConflict: 'overwrite', dryRun: true });
    expect(result.written).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/index.test.ts -t importEntryBundle`
Expected: FAIL — `importEntryBundle` not exported.

- [ ] **Step 3: Implement `importEntryBundle`**

```typescript
// src/entry-bundle/index.ts — add
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ConflictPolicy = 'skip' | 'overwrite' | 'rename';

export interface ImportEntryResult {
  written: boolean;
  skipped: boolean;
  renamed: boolean;
  kind: EntryKind;
  slug: string;
  entryPath: string;
  assetPaths: string[];
  warnings: string[];
}

export async function importEntryBundle({
  cwd,
  config,
  zip,
  onConflict,
  dryRun = false,
}: {
  cwd: string;
  config: LaurelConfig;
  zip: Uint8Array;
  onConflict: ConflictPolicy;
  dryRun?: boolean;
}): Promise<ImportEntryResult> {
  const bundle = parseEntryBundleZip(zip);
  const root = entryRoot(cwd, config, bundle.kind);
  await mkdir(root, { recursive: true });

  const requestedSlug = safeSlug(String(bundle.frontmatter.slug ?? bundle.slug));
  const target = resolveImportTarget(root, requestedSlug, onConflict);
  const entryPath = relative(cwd, target.path).split(sep).join('/');
  if (target.skipped) {
    return { written: false, skipped: true, renamed: false, kind: bundle.kind, slug: target.slug, entryPath, assetPaths: [], warnings: [] };
  }

  const frontmatter = { ...bundle.frontmatter, slug: target.slug, status: 'needs-review' };
  const source = serializeEntryMarkdown(frontmatter, bundle.body, target.path);

  // assets/<rel> -> assets_dir/<rel>, namespaced by slug to avoid clobbering
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const writes: { dest: string; bytes: Uint8Array }[] = [];
  for (const asset of bundle.assets) {
    const rel = asset.path.slice('assets/'.length);
    const dest = join(assetsRoot, rel);
    await assertWritablePathHasNoSymlink(assetsRoot, dest);
    writes.push({ dest, bytes: asset.bytes });
  }
  await assertWritablePathHasNoSymlink(root, target.path);

  const warnings = collectImportWarnings(cwd, config, frontmatter);

  if (!dryRun) {
    await writeFile(target.path, source, 'utf8');
    for (const w of writes) {
      await mkdir(dirname(w.dest), { recursive: true });
      await writeFile(w.dest, w.bytes);
    }
  }

  return {
    written: !dryRun,
    skipped: false,
    renamed: target.renamed,
    kind: bundle.kind,
    slug: target.slug,
    entryPath,
    assetPaths: bundle.assets.map((a) => a.path),
    warnings,
  };
}
```

> Port `resolveImportTarget`, `assertWritablePathHasNoSymlink`, `isInsidePath`, `safeSlug` from the old page-bundle into this file (generalized to take any `root`, not just `pageRoot`). `collectImportWarnings` returns `["author \"x\" not found in content/authors"]` when `frontmatter.author`/`authors` reference an unknown author file — read `content/authors/` and compare; return `[]` if the dir is absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/index.test.ts -t importEntryBundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entry-bundle/index.ts tests/entry-bundle/index.test.ts
git commit -m "feat(entry-bundle): import a zip bundle, overwrite on collision, land needs-review"
```

---

### Task 8: Stamp the exporter's own copy to needs-review

Export means "sent for review": the source file on disk must also become `needs-review` so the exporter's dashboard reflects it.

**Files:**
- Modify: `src/entry-bundle/index.ts` (add `markEntryNeedsReview`)
- Test: `tests/entry-bundle/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/entry-bundle/index.test.ts — add
import { markEntryNeedsReview } from '~/entry-bundle/index.ts';

test('markEntryNeedsReview rewrites the source file status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-mark-'));
  await mkdir(join(dir, 'content', 'posts'), { recursive: true });
  await writeFile(join(dir, 'content', 'posts', 'hello.md'), '---\ntitle: Hello\nstatus: draft\n---\n\nbody\n', 'utf8');
  await markEntryNeedsReview({ cwd: dir, config: cfg(), kind: 'post', slug: 'hello' });
  const after = await readFile(join(dir, 'content', 'posts', 'hello.md'), 'utf8');
  expect(after).toMatch(/status:\s*needs-review/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/entry-bundle/index.test.ts -t markEntryNeedsReview`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/entry-bundle/index.ts — add
export async function markEntryNeedsReview({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: LaurelConfig;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  const resolved = await resolveContentSlugPath(slug, [kind === 'post' ? 'posts' : 'pages'], {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  });
  if (!resolved) throw new Error(`${kind} not found: ${slug}`);
  const raw = await readFile(resolved.path, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath: resolved.path });
  const source = serializeEntryMarkdown({ ...parsed.data, status: 'needs-review' }, parsed.body, resolved.path);
  await writeFile(resolved.path, source, 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/entry-bundle/index.test.ts -t markEntryNeedsReview`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entry-bundle/index.ts tests/entry-bundle/index.test.ts
git commit -m "feat(entry-bundle): mark exporter source copy as needs-review"
```

---

### Task 9: Dashboard endpoints — replace `/api/page-bundles/*`

Swap the page-bundle endpoints for `GET /api/bundles/export?kind=&slug=` (streams a zip download) and `POST /api/bundles/import` (multipart zip). Reuse the existing multipart staging pattern at `dashboard.ts:1748-1797` (size cap, `validateWriteRequest`, temp staging, `changeBus.broadcast`).

**Files:**
- Modify: `src/cli/commands/dashboard.ts` (export endpoint near :1476, page-bundle endpoint :1748-1797, and the GET export-page-bundle handler the explore notes near `/api/page-bundles/export/{slug}`)
- Test: `tests/cli/commands/dashboard.test.ts` (replace page-bundle cases)

- [ ] **Step 1: Write the failing test** — adapt the existing page-bundle dashboard test to POST a zip (built via `exportEntryBundle`) to `/api/bundles/import` and assert `result.written` and the landed `status: needs-review`; and GET `/api/bundles/export?kind=post&slug=...` returns `application/zip`. (Mirror the existing test's server bootstrap.)

- [ ] **Step 2: Run** `bun test tests/cli/commands/dashboard.test.ts` → FAIL (routes 404 / old route gone).

- [ ] **Step 3: Implement the routes.**

Export (replace the `/api/page-bundles/export/...` handler):

```typescript
if (request.method === 'GET' && url.pathname === '/api/bundles/export') {
  const kind = stringParam(url, 'kind');
  const slug = stringParam(url, 'slug');
  if ((kind !== 'post' && kind !== 'page') || !slug) {
    return jsonResponse({ error: 'kind (post|page) and slug are required' }, 400);
  }
  const { exportEntryBundle, markEntryNeedsReview } = await import('~/entry-bundle/index.ts');
  const config = await loadDashboardConfig(ctx); // use whatever config accessor the file already uses
  const { zip } = await exportEntryBundle({ cwd: ctx.cwd, config, kind, slug });
  await markEntryNeedsReview({ cwd: ctx.cwd, config, kind, slug });
  ctx.changeBus.broadcast({ reason: 'bundle-export', kind: kind === 'post' ? 'posts' : 'pages' });
  return new Response(zip, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${slug}.laurel.zip"`,
    },
  });
}
```

Import (replace `/api/page-bundles/import`, keep the multipart staging structure):

```typescript
if (request.method === 'POST' && url.pathname === '/api/bundles/import') {
  const blocked = validateWriteRequest(request, ctx.security);
  if (blocked) return blocked;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return jsonResponse({ error: 'file field is required' }, 400);
  if (file.size > 50 * 1024 * 1024) return jsonResponse({ error: 'bundle exceeds 50MB limit' }, 413);
  const dryRun = String(form?.get('dryRun') ?? 'true') !== 'false';
  const onConflict = (String(form?.get('onConflict') ?? 'skip')) as 'skip' | 'overwrite' | 'rename';
  try {
    const { importEntryBundle } = await import('~/entry-bundle/index.ts');
    const config = await loadDashboardConfig(ctx);
    const result = await importEntryBundle({
      cwd: ctx.cwd,
      config,
      zip: new Uint8Array(await file.arrayBuffer()),
      onConflict,
      dryRun,
    });
    if (result.written) {
      ctx.changeBus.broadcast({ reason: 'bundle-import', kind: result.kind === 'post' ? 'posts' : 'pages' });
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}
```

> Use the file's existing config accessor (the explore notes config is loaded via `ctx.configPath`); replace `loadDashboardConfig(ctx)` with the real call already used elsewhere in this handler. Delete `runDashboardPageBundleImport`, `DashboardPageBundleImportPayload`, and the old GET export-page-bundle handler.

- [ ] **Step 4: Run** `bun test tests/cli/commands/dashboard.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/dashboard.ts tests/cli/commands/dashboard.test.ts
git commit -m "feat(dashboard): zip bundle export/import endpoints for posts and pages"
```

---

### Task 10: Migrate CLI `export`/`import` commands

`src/cli/commands/export.ts` and `import.ts` call the page-bundle. Repoint them to `exportEntryBundle`/`importEntryBundle`, accepting a `--kind` (default `post`) and writing/reading a `.zip` file.

**Files:**
- Modify: `src/cli/commands/export.ts`, `src/cli/commands/import.ts`
- Modify: `src/cli/specs.ts`, `src/cli/dashboard/bundled-assets.ts` (drop page-bundle references)
- Test: existing CLI command tests for export/import (adapt to zip)

- [ ] **Step 1:** Read both command files and their tests; write/adapt a failing test that exports a post to a `.zip` then imports it into a second temp dir, asserting the entry lands with `status: needs-review`.
- [ ] **Step 2:** Run the command tests → FAIL.
- [ ] **Step 3:** Replace page-bundle calls: on export, `await Bun.write(outPath, (await exportEntryBundle(...)).zip)`; on import, `await importEntryBundle({ ..., zip: new Uint8Array(await Bun.file(path).arrayBuffer()), onConflict })`. Add `--kind post|page`. Remove now-dead page-bundle imports from `specs.ts`/`bundled-assets.ts`.
- [ ] **Step 4:** Run the command tests → PASS.
- [ ] **Step 5:** Commit `feat(cli): export/import entries as zip bundles`.

---

### Task 11: Client API — zip download + import

**Files:**
- Modify: `src/cli/dashboard/web/lib/api.ts` (replace `exportPageBundle` near :604)

- [ ] **Step 1:** Write/adapt a test if the lib has tests; otherwise this is verified via Task 13 UI smoke + typecheck.
- [ ] **Step 2:** Replace `exportPageBundle(slug)` with:

```typescript
export function bundleExportUrl(kind: 'post' | 'page', slug: string): string {
  return `/api/bundles/export?kind=${encodeURIComponent(kind)}&slug=${encodeURIComponent(slug)}`;
}

export async function importBundle(
  file: File,
  opts: { dryRun: boolean; onConflict: 'skip' | 'overwrite' | 'rename' },
): Promise<ImportBundleResult> {
  const form = new FormData();
  form.set('file', file);
  form.set('dryRun', String(opts.dryRun));
  form.set('onConflict', opts.onConflict);
  const res = await fetch('/api/bundles/import', { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Import failed (${res.status})`);
  return res.json();
}
```

> `authHeaders()` / token attachment: match the file's existing pattern (`setDashboardToken`). Define `ImportBundleResult` to mirror `ImportEntryResult`. Export-as-download is a normal anchor/`window.location` to `bundleExportUrl(...)` (no fetch needed) so the browser saves the zip.

- [ ] **Step 3:** Run `bun run typecheck` → PASS.
- [ ] **Step 4:** Commit `feat(dashboard-web): zip bundle client API`.

---

### Task 12: ContentTable — export button, import UI, status column, needs-review filter

**Files:**
- Modify: `src/cli/dashboard/web/components/ContentTable.tsx` (export overflow near :314, table header/rows, toolbar)

- [ ] **Step 1:** Replace the `ExportOverflow` page-bundle action with "Export for review" that navigates to `bundleExportUrl(kind, slug)` (kind derived from the table's current content kind). Add an "Import zip" control (file input) that calls `importBundle(file, { dryRun: true, ... })` first; if the dry-run reports a slug collision, show the existing `ConfirmDialog` ("A post with this slug exists. Overwrite and mark for review?"), then call `importBundle(file, { dryRun: false, onConflict: 'overwrite' })`. On success, trigger the existing content-refresh.
- [ ] **Step 2:** Add a `status` column to the table (render `frontmatter.status ?? 'published'`) and a toolbar filter that narrows rows to `status === 'needs-review'`.
- [ ] **Step 3:** Run `bun run typecheck` → PASS. Run the dashboard dev server (`bun run src/cli/index.ts dashboard --dev`) and manually verify export downloads a zip and import round-trips. (Manual verification step — covered formally in Task 13.)
- [ ] **Step 4:** Commit `feat(dashboard-web): export/import zip bundles, status column, needs-review filter`.

---

### Task 13: Delete page-bundle and verify end to end

**Files:**
- Delete: `src/page-bundle/index.ts`, `tests/page-bundle/index.test.ts`
- Verify: full repo

- [ ] **Step 1:** Grep for leftover references:

Run: `grep -rn "page-bundle\|PageBundle\|page-bundles\|laurel.page.v1\|exportPageBundle" src tests`
Expected: no matches. Fix any stragglers (`specs.ts`, `bundled-assets.ts`, web components, tests).

- [ ] **Step 2:** Delete the module and its test:

```bash
git rm src/page-bundle/index.ts tests/page-bundle/index.test.ts
```

- [ ] **Step 3:** Full check:

Run: `bun run check && bun run typecheck && bun test`
Expected: PASS, no `any`, Biome clean.

- [ ] **Step 4:** Manual e2e in the dashboard dev server: export a post → `<slug>.laurel.zip` downloads; the source post shows `needs-review`; import the zip into the same site → confirm dialog → overwrite → post is `needs-review`; build (`laurel build`) excludes it from `dist`.

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: remove JSON page-bundle in favor of zip entry-bundle"
```

---

## Self-Review

**Spec coverage:**
- Zip codec (writer+reader) → Tasks 3, 4. ✓
- Kind-aware EntryBundle, ported safety logic → Tasks 5, 6, 7. ✓
- Export stamps needs-review (zip + source copy) → Tasks 6, 8. ✓
- Import overwrite-on-collision, lands needs-review, untrusted-input validation (zip-slip, manifest, size caps) → Tasks 5, 7. ✓
- Status enum + publish gate → Tasks 1, 2. ✓
- Dashboard endpoints, CLI, client API, UI (export/import/status column/filter/confirm dialog) → Tasks 9–12. ✓
- Delete page-bundle + migrate all wiring → Tasks 9–13. ✓
- Edge cases: missing asset (omittedAssets, Task 6), unknown author (warnings, Task 7), asset namespacing (Task 7), version mismatch (manifest carries version, best-effort), cancel-leaves-tree-unchanged (dryRun + confirm, Tasks 7/12). ✓

**Gaps to confirm during execution (not blockers):**
- Real loader entry-point signature (Task 2) and dashboard config accessor (Task 9) must be matched to the actual code — flagged inline.
- `scheduled` status interplay with the not-published predicate (Task 2 Step 5) — reconcile if a test breaks.

**Placeholder scan:** No TBD/TODO in logic steps; each code step contains runnable code. Migration tasks (10–12) reference exact symbols/paths and give concrete new code; the "read the file and adapt" notes are explicit transformation instructions, not deferrals.

**Type consistency:** `EntryKind`, `BUNDLE_SCHEMA`, `ConflictPolicy`, `ImportEntryResult`, `ParsedEntryBundle`, `createZipArchive`/`ZipInputEntry`, `readZipArchive`/`ZipFileEntry` are defined once and reused across tasks. `exportEntryBundle` returns `{ zip, omittedAssets }`; consumers (Tasks 9–10) use `.zip`. ✓
