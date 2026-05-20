import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function expectLfOnly(bytes: Uint8Array): void {
  expect(bytes.includes(13)).toBe(false);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('cli new — slug collision handling', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-new-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('creates a new post when the destination does not exist', async () => {
    const { exitCode } = await runCli(['new', 'post', 'Hello World'], dir);
    expect(exitCode).toBe(0);
    const dest = join(dir, 'content/posts/hello-world.md');
    const body = await readFile(dest, 'utf8');
    expect(body).toContain('title: "Hello World"');
    expect(body).toContain('slug: hello-world');
  });

  test('writes LF-only markdown when Windows CRLF text reaches the scaffold input', async () => {
    const { exitCode } = await runCli(['new', 'post', 'Windows\r\nLine Ending'], dir);
    expect(exitCode).toBe(0);

    const dest = join(dir, 'content/posts/windows-line-ending.md');
    const bytes = await readFile(dest);
    expectLfOnly(bytes);

    const body = new TextDecoder().decode(bytes);
    expect(body).toContain('# Windows\nLine Ending');
  });

  test('creates a post from a Japanese title without deriving an empty slug', async () => {
    const { exitCode } = await runCli(['new', 'post', '日本語タイトル'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/日本語タイトル.md'), 'utf8');
    expect(body).toContain('title: "日本語タイトル"');
    expect(body).toContain('slug: 日本語タイトル');
  });

  test('preserves CJK words when a title also contains ASCII words', async () => {
    const { exitCode } = await runCli(['new', 'post', '東京 Update'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/東京-update.md'), 'utf8');
    expect(body).toContain('slug: 東京-update');
  });

  test('refuses to overwrite an existing file and exits 1 with guidance', async () => {
    const dest = join(dir, 'content/posts/hello-world.md');
    await Bun.write(dest, 'EXISTING CONTENT');

    const { stderr, exitCode } = await runCli(['new', 'post', 'Hello World'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${dest}.`);
    expect(stderr).toContain('Pass --force to overwrite or --slug <other>.');

    const body = await readFile(dest, 'utf8');
    expect(body).toBe('EXISTING CONTENT');
  });

  test('--force overwrites an existing file', async () => {
    const dest = join(dir, 'content/posts/hello-world.md');
    await Bun.write(dest, 'EXISTING CONTENT');

    const { exitCode } = await runCli(['new', 'post', 'Hello World', '--force'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(dest, 'utf8');
    expect(body).not.toBe('EXISTING CONTENT');
    expect(body).toContain('title: "Hello World"');
  });

  test('--slug writes to the alternate slug path without touching the original', async () => {
    const original = join(dir, 'content/posts/hello-world.md');
    await Bun.write(original, 'EXISTING CONTENT');

    const { exitCode } = await runCli(
      ['new', 'post', 'Hello World', '--slug', 'hello-world-v2'],
      dir,
    );
    expect(exitCode).toBe(0);

    const alt = join(dir, 'content/posts/hello-world-v2.md');
    const altBody = await readFile(alt, 'utf8');
    expect(altBody).toContain('slug: hello-world-v2');
    expect(altBody).toContain('title: "Hello World"');

    const originalBody = await readFile(original, 'utf8');
    expect(originalBody).toBe('EXISTING CONTENT');
  });

  test('--slug also collides with an existing file and is refused', async () => {
    const alt = join(dir, 'content/posts/alt-slug.md');
    await Bun.write(alt, 'OTHER CONTENT');

    const { stderr, exitCode } = await runCli(
      ['new', 'post', 'Hello World', '--slug', 'alt-slug'],
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${alt}.`);

    const body = await readFile(alt, 'utf8');
    expect(body).toBe('OTHER CONTENT');
  });

  test('pages honor the same overwrite protection', async () => {
    const dest = join(dir, 'content/pages/about.md');
    await Bun.write(dest, 'EXISTING PAGE');

    const { stderr, exitCode } = await runCli(['new', 'page', 'About'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${dest}.`);
  });

  test('honors content.posts_dir / pages_dir overrides from nectar.toml', async () => {
    await Bun.write(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "T"',
        '',
        '[content]',
        'posts_dir = "src/posts"',
        'pages_dir = "src/pages"',
        '',
      ].join('\n'),
    );

    const post = await runCli(['new', 'post', 'Hello World'], dir);
    expect(post.exitCode).toBe(0);
    const postBody = await readFile(join(dir, 'src/posts/hello-world.md'), 'utf8');
    expect(postBody).toContain('slug: hello-world');

    const page = await runCli(['new', 'page', 'About'], dir);
    expect(page.exitCode).toBe(0);
    const pageBody = await readFile(join(dir, 'src/pages/about.md'), 'utf8');
    expect(pageBody).toContain('slug: about');
  });

  test('--config points at an alternate config file', async () => {
    await Bun.write(
      join(dir, 'alt.toml'),
      ['[site]', 'title = "T"', '', '[content]', 'posts_dir = "drafts"', ''].join('\n'),
    );

    const { exitCode } = await runCli(['new', 'post', 'Hello World', '--config', 'alt.toml'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'drafts/hello-world.md'), 'utf8');
    expect(body).toContain('slug: hello-world');
  });

  test('--config=value (equals form) is parsed identically to --config value', async () => {
    await Bun.write(
      join(dir, 'alt.toml'),
      ['[site]', 'title = "T"', '', '[content]', 'posts_dir = "drafts"', ''].join('\n'),
    );

    const { exitCode } = await runCli(['new', 'post', 'Hello Equals', '--config=alt.toml'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'drafts/hello-equals.md'), 'utf8');
    expect(body).toContain('slug: hello-equals');
  });
});

describe('cli new — frontmatter flags', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-new-flags-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--draft writes status: draft into the frontmatter', async () => {
    const { exitCode } = await runCli(['new', 'post', 'Hello World', '--draft'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/hello-world.md'), 'utf8');
    expect(body).toContain('status: draft');
  });

  test('--date overrides the published date with an ISO-normalized value', async () => {
    const { exitCode } = await runCli(
      ['new', 'post', 'Backdated Post', '--date', '2024-01-02T03:04:05Z'],
      dir,
    );
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/backdated-post.md'), 'utf8');
    expect(body).toContain('date: 2024-01-02T03:04:05.000Z');
  });

  test('--date rejects values that do not parse as a date', async () => {
    const { stderr, exitCode } = await runCli(
      ['new', 'post', 'Bad Date', '--date', 'not-a-date'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --date value');
  });

  test('--tags slugifies each item and writes the list into the frontmatter', async () => {
    const { exitCode } = await runCli(
      ['new', 'post', 'Tagged', '--tags', 'News, Getting Started ,migration'],
      dir,
    );
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/tagged.md'), 'utf8');
    expect(body).toContain('tags: ["news", "getting-started", "migration"]');
  });

  test('repeated --tags values are accumulated before slugifying', async () => {
    const { exitCode } = await runCli(
      ['new', 'post', 'Repeated Tags', '--tags', 'News', '--tags', 'Getting Started,migration'],
      dir,
    );
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/repeated-tags.md'), 'utf8');
    expect(body).toContain('tags: ["news", "getting-started", "migration"]');
  });

  test('--author writes a single-element authors array', async () => {
    const { exitCode } = await runCli(['new', 'post', 'By Casper', '--author', 'casper'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/by-casper.md'), 'utf8');
    expect(body).toContain('authors: ["casper"]');
  });

  test('--draft is allowed on page but --tags / --author / --date are not', async () => {
    const ok = await runCli(['new', 'page', 'About', '--draft'], dir);
    expect(ok.exitCode).toBe(0);
    const pageBody = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
    expect(pageBody).toContain('status: draft');

    const bad = await runCli(['new', 'page', 'About Two', '--tags', 'news'], dir);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain('only valid for "post" kind');
  });

  test('--open logs the created path and continues when no editor is set', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'new', 'post', 'No Editor', '--open'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, EDITOR: '', VISUAL: '' },
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('--open was passed but neither $VISUAL nor $EDITOR is set');
    expect(stderr).toContain(join(dir, 'content/posts/no-editor.md'));
    const body = await readFile(join(dir, 'content/posts/no-editor.md'), 'utf8');
    expect(body).toContain('slug: no-editor');
  });

  test('--open invokes $EDITOR with the created file path', async () => {
    const marker = join(dir, 'editor-was-called.txt');
    const editor = join(dir, 'fake-editor.sh');
    await Bun.write(editor, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`);
    await Bun.spawn(['chmod', '+x', editor]).exited;

    const proc = Bun.spawn(['bun', CLI_ENTRY, 'new', 'post', 'With Editor', '--open'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, EDITOR: editor, VISUAL: '' },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(join(dir, 'content/posts/with-editor.md'));
  });

  test('--open prefers $VISUAL over $EDITOR', async () => {
    const marker = join(dir, 'visual-was-called.txt');
    const editorMarker = join(dir, 'editor-was-called.txt');
    const visual = join(dir, 'fake-visual.sh');
    const editor = join(dir, 'fake-editor.sh');
    await Bun.write(visual, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`);
    await Bun.write(editor, `#!/bin/sh\nprintf '%s' "$1" > '${editorMarker}'\n`);
    await Bun.spawn(['chmod', '+x', visual, editor]).exited;

    const proc = Bun.spawn(['bun', CLI_ENTRY, 'new', 'post', 'With Visual', '--open'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, EDITOR: editor, VISUAL: visual },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(join(dir, 'content/posts/with-visual.md'));
    expect(await fileExists(editorMarker)).toBe(false);
  });
});

describe('cli new — tag and author kinds', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-new-meta-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('"new tag <slug>" writes into content.tags_dir with slug + name', async () => {
    const { exitCode } = await runCli(['new', 'tag', 'getting-started'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/tags/getting-started.md'), 'utf8');
    expect(body).toContain('slug: getting-started');
    expect(body).toContain('name: "Getting Started"');
    expect(body).toContain('description:');
    expect(body).not.toContain('date:');
    expect(body).not.toContain('tags:');
  });

  test('"new tag <slug>" accepts a Japanese slug', async () => {
    const { exitCode } = await runCli(['new', 'tag', 'ニュース'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/tags/ニュース.md'), 'utf8');
    expect(body).toContain('slug: ニュース');
    expect(body).toContain('name: "ニュース"');
  });

  test('"new author <slug>" writes into content.authors_dir with slug + name + bio', async () => {
    const { exitCode } = await runCli(['new', 'author', 'casper'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/authors/casper.md'), 'utf8');
    expect(body).toContain('slug: casper');
    expect(body).toContain('name: "Casper"');
    expect(body).toContain('bio:');
  });

  test('"new tag" rejects --date / --tags / --author / --slug', async () => {
    const r = await runCli(['new', 'tag', 'news', '--tags', 'x'], dir);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('only valid for "post" kind');
  });

  test('"new author" honors content.authors_dir override', async () => {
    await Bun.write(
      join(dir, 'nectar.toml'),
      ['[site]', 'title = "T"', '', '[content]', 'authors_dir = "team"', ''].join('\n'),
    );
    const { exitCode } = await runCli(['new', 'author', 'jane'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'team/jane.md'), 'utf8');
    expect(body).toContain('slug: jane');
  });

  test('unknown kind produces a usage error listing all valid kinds', async () => {
    const { stderr, exitCode } = await runCli(['new', 'widget', 'Hello'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid kind: widget');
    expect(stderr).toContain('post, page, tag, author');
  });
});
