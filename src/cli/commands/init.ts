import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { ensureDir } from '~/util/fs.ts';
import { colorize, getColorEnabled } from '~/util/logger.ts';
import { writeGeneratedTextFile } from '../line-endings.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { INIT_SPEC } from '../specs.ts';

const KNOWN_THEMES = ['source', 'casper', 'edition', 'dawn', 'alto'] as const;
type KnownTheme = (typeof KNOWN_THEMES)[number];

export interface InitAnswers {
  title: string;
  url: string;
  theme: string;
  starterContent: boolean;
  rss: boolean;
}

// Site title intentionally has no hardcoded default. The placeholder is
// derived from the target directory at runtime (e.g. `stork-blog` →
// `Stork Blog`) so the operator never sees a misleading "My Nectar Site"
// pre-fill that doesn't match their project.
const DEFAULT_ANSWERS: Omit<InitAnswers, 'title'> = {
  url: 'http://localhost:4321',
  theme: 'source',
  starterContent: true,
  rss: true,
};

// Turn a directory slug into a human-readable site title. Splits on
// hyphens / underscores / whitespace, drops empty fragments, then
// capitalises each word. Empty input falls back to "My Site" so the
// generated nectar.toml always has a non-empty `[site].title`.
function deriveSiteTitle(targetDir: string): string {
  const raw = targetDir.length > 0 ? basename(targetDir) : '';
  const words = raw
    .split(/[-_\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .map((w) => `${w[0]?.toUpperCase() ?? ''}${w.slice(1).toLowerCase()}`);
  return words.length > 0 ? words.join(' ') : 'My Site';
}

// Conflict policy for individual generated files. Files split into three
// buckets so a half-initialised project doesn't fail outright on the next
// `nectar init` run while still protecting the load-bearing nectar.toml:
//   - 'overwrite': refuse to clobber without --force (used for nectar.toml).
//   - 'skip':     leave the existing copy alone and continue; emit an info log.
//   - 'merge':    read existing content, augment it via the file's `merge` hook
//                  (used for package.json: add scripts + devDependencies that
//                  Nectar wants without disturbing anything the operator already
//                  configured).
type ConflictPolicy = 'overwrite' | 'skip' | 'merge';

interface ProjectFile {
  path: string;
  contents: string;
  policy?: ConflictPolicy;
  merge?: (existing: string) => string;
}

export async function runInit(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(INIT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(INIT_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(INIT_SPEC));
    return 0;
  }

  const force = parsed.values.force === true;
  const yes = parsed.values.yes === true;
  const dirArg = typeof parsed.values.dir === 'string' ? parsed.values.dir : '.';
  const targetDir = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg);

  await ensureDir(targetDir);

  const titleFallback = deriveSiteTitle(targetDir);
  let answers: InitAnswers;
  if (yes) {
    answers = { title: titleFallback, ...DEFAULT_ANSWERS };
  } else {
    try {
      // Use the clack-based picker when stdin is an actual terminal (arrow
      // keys, highlighting, cancel-on-Ctrl-C). Pipe / CI / test environments
      // (`bun test` spawns with a Blob stdin) keep the legacy readline-based
      // flow so existing automation that pipes answers via newlines still
      // works.
      answers =
        process.stdin.isTTY === true
          ? await promptAnswersInteractive(DEFAULT_ANSWERS, titleFallback)
          : await promptAnswersFromStdin(DEFAULT_ANSWERS, titleFallback);
    } catch (err) {
      process.stderr.write(
        `Failed to read answers from stdin: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
  }

  const files = renderProject(answers, targetDir);
  // Only files marked 'overwrite' (the default) participate in the refuse-
  // without-force gate. 'skip' / 'merge' files handle conflicts themselves.
  const blockingConflicts = files
    .filter((f) => (f.policy ?? 'overwrite') === 'overwrite')
    .map((f) => ({ file: f, abs: join(targetDir, f.path) }))
    .filter(({ abs }) => existsSync(abs));
  if (blockingConflicts.length > 0 && !force) {
    const list = blockingConflicts.map(({ abs }) => `  ${abs}`).join('\n');
    process.stderr.write(
      `Refusing to overwrite existing files:\n${list}\nPass --force to overwrite.\n`,
    );
    return 1;
  }

  const skipped: string[] = [];
  const merged: string[] = [];
  for (const file of files) {
    const dest = join(targetDir, file.path);
    const exists = existsSync(dest);
    const policy = file.policy ?? 'overwrite';
    if (exists && policy === 'skip') {
      skipped.push(file.path);
      continue;
    }
    if (exists && policy === 'merge' && file.merge) {
      const current = await readFile(dest, 'utf8');
      const next = file.merge(current);
      if (next !== current) {
        await writeGeneratedTextFile(dest, next);
        merged.push(file.path);
      } else {
        skipped.push(file.path);
      }
      continue;
    }
    await ensureDir(dirnameOf(dest));
    await writeGeneratedTextFile(dest, file.contents);
  }

  writeNextSteps({
    targetDir,
    theme: answers.theme,
    skipped,
    merged,
  });
  return 0;
}

interface NextStepsOptions {
  targetDir: string;
  theme: string;
  skipped: string[];
  merged: string[];
}

// Render the post-init "what now?" block. Direct stdout writes (no logger
// prefixes) so the section icons + indent stay aligned; emojis are gated on
// `getColorEnabled()` because the same predicate already covers "rich
// terminal" detection elsewhere in the CLI, and a piped / NO_COLOR run
// gets the plain-ASCII variant for free.
function writeNextSteps(opts: NextStepsOptions): void {
  const rich = getColorEnabled();
  const g = sectionGlyphs(rich);
  const dim = (s: string) => colorize(s, 'gray');
  const accent = (s: string) => colorize(s, 'cyan');
  const ok = (s: string) => colorize(s, 'green');
  const out: string[] = [];

  out.push('');
  out.push(`   ${g.brand}  ${accent('Nectar project initialised')}`);
  out.push(`      ${dim(opts.targetDir)}`);
  if (opts.skipped.length > 0 || opts.merged.length > 0) {
    out.push('');
    for (const path of opts.skipped) out.push(`      ${dim(`· Skipped existing ${path}`)}`);
    for (const path of opts.merged) out.push(`      ${dim(`· Merged into existing ${path}`)}`);
  }
  out.push('');
  out.push(`   ${g.theme}  ${accent('Vendor a Ghost theme')}  ${dim('(one-time)')}`);
  out.push(
    `       git clone https://github.com/TryGhost/${themeRepo(opts.theme)} themes/${opts.theme}`,
  );
  out.push('');
  out.push(`   ${g.gui}  ${accent('GUI development (dashboard)')}`);
  out.push(
    `       nectar dashboard       ${dim('→')} ${accent('http://localhost:4322/')}   ${dim('(editor UI)')}`,
  );
  out.push('');
  out.push(`   ${g.cli}  ${accent('CLI development')}`);
  out.push(
    `       nectar dev             ${dim('→')} ${accent('http://localhost:4321/')}   ${dim('(live reload)')}`,
  );
  out.push(`       nectar build           ${dim('→')} dist/`);
  out.push('');
  out.push(`   ${g.tip}  ${accent('Migrating from Ghost?')}`);
  out.push(
    `       ${dim('Open `nectar dashboard` → Migration tab to upload your Ghost JSON export.')}`,
  );
  out.push('');
  out.push(`   ${g.ai}  ${accent('Teach your AI assistant about Nectar')}`);
  out.push(`       ${dim('Create CLAUDE.md or AGENTS.md, then run `nectar skill install`.')}`);
  out.push('');
  // A single trailing OK line so non-colour users still see a clear
  // success marker without needing to scan for the brand glyph.
  out.push(`   ${ok(rich ? '✓' : 'OK')} Ready.`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

interface SectionGlyphs {
  brand: string;
  theme: string;
  gui: string;
  cli: string;
  tip: string;
  ai: string;
}

// Rich (TTY + colour) → emoji icons that mirror the section purpose.
// ASCII fallback uses bracketed labels so a plain pipe still groups the
// blocks visually. Same predicate drives every glyph choice.
function sectionGlyphs(rich: boolean): SectionGlyphs {
  if (rich) {
    return {
      brand: '🐝',
      theme: '📂',
      gui: '🖥️ ',
      cli: '⚡',
      tip: '💡',
      ai: '🤖',
    };
  }
  return {
    brand: '[*]',
    theme: '[theme]',
    gui: '[gui]',
    cli: '[cli]',
    tip: '[tip]',
    ai: '[ai]',
  };
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

// Recommended upstream repo per known theme. Used in the `git clone` hint
// printed after `nectar init`. Falls back to the canonical Source repo for
// any value Nectar doesn't recognise — the operator can swap it as needed.
function themeRepo(theme: string): string {
  switch (theme) {
    case 'casper':
      return 'Casper';
    case 'edition':
      return 'Edition';
    case 'dawn':
      return 'Dawn';
    case 'alto':
      return 'Alto';
    default:
      return 'Source';
  }
}

// Content subdirectories that mirror `[content]` keys in nectar.toml. We
// always seed them with `.gitkeep` so the layout shows up in git even when
// the operator skipped starter content -- empty dirs would otherwise be
// invisible and contributors might not realise where to drop new files.
const CONTENT_SUBDIRS = ['posts', 'pages', 'authors', 'tags', 'images'] as const;

export function renderProject(answers: InitAnswers, _targetDir = ''): ProjectFile[] {
  const files: ProjectFile[] = [
    { path: 'nectar.toml', contents: renderConfig(answers) },
    { path: '.gitignore', contents: renderGitignore(), policy: 'skip' },
    { path: 'README.md', contents: renderReadme(answers), policy: 'skip' },
  ];
  for (const sub of CONTENT_SUBDIRS) {
    files.push({ path: `content/${sub}/.gitkeep`, contents: '', policy: 'skip' });
  }
  if (answers.starterContent) {
    files.push({
      path: 'content/posts/welcome.md',
      contents: renderWelcomePost(answers),
      policy: 'skip',
    });
    files.push({
      path: 'content/pages/about.md',
      contents: renderAboutPage(answers),
      policy: 'skip',
    });
    files.push({
      path: 'content/authors/default.md',
      contents: renderDefaultAuthor(),
      policy: 'skip',
    });
  }
  return files;
}

function renderConfig(a: InitAnswers): string {
  const lines: string[] = [];
  lines.push('[site]');
  lines.push(`title = ${tomlString(a.title)}`);
  lines.push(`description = ${tomlString('')}`);
  lines.push(`url = ${tomlString(a.url)}`);
  lines.push('locale = "en"');
  lines.push('timezone = "UTC"');
  lines.push('');
  lines.push('[theme]');
  lines.push(`name = ${tomlString(a.theme)}`);
  lines.push('dir = "themes"');
  lines.push('');
  lines.push('[content]');
  lines.push('posts_dir = "content/posts"');
  lines.push('pages_dir = "content/pages"');
  lines.push('authors_dir = "content/authors"');
  lines.push('tags_dir = "content/tags"');
  lines.push('assets_dir = "content/images"');
  lines.push('');
  lines.push('[build]');
  lines.push('output_dir = "dist"');
  lines.push('base_path = "/"');
  lines.push('posts_per_page = 12');
  lines.push('copy_content_assets = true');
  lines.push('');
  lines.push('[[navigation]]');
  lines.push('label = "Home"');
  lines.push('url = "/"');
  lines.push('');
  lines.push('[[navigation]]');
  lines.push('label = "About"');
  lines.push('url = "/about/"');
  lines.push('');
  lines.push('[components.rss]');
  lines.push(`enabled = ${a.rss ? 'true' : 'false'}`);
  lines.push('items = 20');
  lines.push('');
  lines.push('[components.sitemap]');
  lines.push('enabled = true');
  lines.push('');
  lines.push('[components.opengraph]');
  lines.push('enabled = true');
  lines.push('');
  lines.push('[components.comments]');
  lines.push('provider = "off"  # "off" | "giscus" | "disqus" | "utterances" | "webmention.io"');
  lines.push('# repo = "owner/repo"           # giscus, utterances');
  lines.push('# shortname = "your-shortname"  # disqus');
  lines.push('# username = "you.example.com"  # webmention.io');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderGitignore(): string {
  // `.nectar/` covers the per-project cache (`.nectar/cache/`) plus any
  // future sibling state Nectar might write under the same namespace.
  return ['node_modules/', 'dist/', '.worktrees/', '.nectar/', '.DS_Store', ''].join('\n');
}

function renderReadme(a: InitAnswers): string {
  const lines: string[] = [];
  lines.push(`# ${a.title}`);
  lines.push('');
  lines.push('A static site built with [Nectar](https://github.com/t09tanaka/nectar) —');
  lines.push('a Ghost-compatible SSG running on Bun + TypeScript.');
  lines.push('');
  lines.push('## Getting started');
  lines.push('');
  lines.push('Assumes [Nectar](https://github.com/t09tanaka/nectar) is installed globally');
  lines.push('(`npm install -g nectar`). Once the theme is vendored, drive the project');
  lines.push('either from the dashboard or from the CLI:');
  lines.push('');
  lines.push('```sh');
  lines.push(
    `git clone https://github.com/TryGhost/${themeRepo(a.theme)} themes/${a.theme}   # vendor the theme`,
  );
  lines.push('');
  lines.push('# GUI development');
  lines.push('nectar dashboard           # http://localhost:4322/  (editor UI)');
  lines.push('');
  lines.push('# CLI development');
  lines.push('nectar dev                 # http://localhost:4321/  (live reload)');
  lines.push('nectar build               # writes dist/');
  lines.push('```');
  lines.push('');
  lines.push('## Project layout');
  lines.push('');
  lines.push('- `nectar.toml` — site config (title, theme, components).');
  lines.push('- `content/posts/` — Markdown posts with YAML frontmatter.');
  lines.push('- `content/pages/` — Static pages (about, contact, …).');
  lines.push('- `content/authors/` — Author metadata.');
  lines.push(`- \`themes/${a.theme}/\` — Ghost theme used for rendering.`);
  lines.push('  Vendor a theme here before building (see Getting started).');
  lines.push('');
  lines.push('## Deployment');
  lines.push('');
  lines.push('Deploy the generated `dist/` directory to any static host (GitHub Pages, Netlify,');
  lines.push('Vercel, Cloudflare Pages, S3, …). Use `npm run build` as the build command and');
  lines.push('`dist/` as the publish directory.');
  lines.push('');
  return lines.join('\n');
}

function renderWelcomePost(a: InitAnswers): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${JSON.stringify(`Welcome to ${a.title}`)}`);
  lines.push('slug: welcome');
  lines.push(`date: ${new Date().toISOString()}`);
  lines.push('tags: ["news"]');
  lines.push('authors: ["default"]');
  lines.push('---');
  lines.push('');
  lines.push(`# Welcome to ${a.title}`);
  lines.push('');
  lines.push('This is your first post. Edit it in `content/posts/welcome.md`,');
  lines.push('or scaffold a new one with `nectar new post "My Title"`.');
  lines.push('');
  return lines.join('\n');
}

function renderAboutPage(a: InitAnswers): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('title: "About"');
  lines.push('slug: about');
  lines.push('---');
  lines.push('');
  lines.push(`# About ${a.title}`);
  lines.push('');
  lines.push('Tell readers who you are and what this site is about.');
  lines.push('');
  return lines.join('\n');
}

function renderDefaultAuthor(): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('name: "Default Author"');
  lines.push('slug: default');
  lines.push('---');
  lines.push('');
  lines.push('A short bio goes here.');
  lines.push('');
  return lines.join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

// Interactive mode (TTY): clack handles arrow-key selection, highlighting,
// and Ctrl-C cancellation across platforms. We catch the symbol clack
// returns when the user cancels and throw so the caller falls into the
// normal error path instead of writing a half-formed answer set.
//
// `titleFallback` is the directory-derived placeholder shown to the
// operator. We do NOT pre-fill the text field with it — `initialValue`
// stays undefined so the operator can just type, and the placeholder
// only shows what we would default to on empty submit.
async function promptAnswersInteractive(
  defaults: Omit<InitAnswers, 'title'>,
  titleFallback: string,
): Promise<InitAnswers> {
  clack.intro('Nectar project setup');
  const title = await clack.text({
    message: 'Site title',
    placeholder: titleFallback,
  });
  ensureNotCancelled(title);
  const url = await clack.text({
    message: 'Site URL',
    placeholder: defaults.url,
    initialValue: defaults.url,
  });
  ensureNotCancelled(url);
  const theme = await clack.select<KnownTheme>({
    message: 'Theme',
    options: KNOWN_THEMES.map((name) => ({ value: name, label: name })),
    initialValue: defaults.theme as KnownTheme,
  });
  ensureNotCancelled(theme);
  const starter = await clack.confirm({
    message: 'Include starter content (welcome post, about page)?',
    initialValue: defaults.starterContent,
  });
  ensureNotCancelled(starter);
  const rss = await clack.confirm({
    message: 'Enable RSS feed?',
    initialValue: defaults.rss,
  });
  ensureNotCancelled(rss);
  clack.outro('Generating files...');
  return {
    title: typeof title === 'string' && title.trim().length > 0 ? title.trim() : titleFallback,
    url: typeof url === 'string' && url.trim().length > 0 ? url.trim() : defaults.url,
    theme: theme as string,
    starterContent: starter === true,
    rss: rss === true,
  };
}

function ensureNotCancelled(value: unknown): void {
  if (clack.isCancel(value)) {
    clack.cancel('Aborted.');
    throw new Error('cancelled');
  }
}

// Pipe / CI mode: read newline-delimited answers from stdin so existing
// automation that feeds responses via a Blob keeps working. Mirrors the
// legacy implementation; only the input sanitiser is new.
async function promptAnswersFromStdin(
  defaults: Omit<InitAnswers, 'title'>,
  titleFallback: string,
): Promise<InitAnswers> {
  const reader = createLineReader();
  process.stdout.write('Nectar project setup — press Enter to accept defaults.\n\n');

  const title = await ask(reader, `Site title [${titleFallback}]: `, titleFallback);
  const url = await ask(reader, `Site URL [${defaults.url}]: `, defaults.url);
  const themeChoice = await chooseFromList(reader, 'Theme', [...KNOWN_THEMES], defaults.theme);
  const starter = await yesNo(
    reader,
    'Include starter content (welcome post, about page)?',
    defaults.starterContent,
  );
  const rss = await yesNo(reader, 'Enable RSS feed?', defaults.rss);

  return {
    title,
    url,
    theme: themeChoice,
    starterContent: starter,
    rss,
  };
}

interface LineReader {
  next(): Promise<string | null>;
}

function createLineReader(): LineReader {
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const iter = (process.stdin as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();

  return {
    async next(): Promise<string | null> {
      while (true) {
        const nlIndex = buffer.indexOf('\n');
        if (nlIndex !== -1) {
          const line = buffer.slice(0, nlIndex);
          buffer = buffer.slice(nlIndex + 1);
          return line.replace(/\r$/, '');
        }
        if (done) {
          if (buffer.length > 0) {
            const tail = buffer;
            buffer = '';
            return tail;
          }
          return null;
        }
        const chunk = await iter.next();
        if (chunk.done) {
          done = true;
          continue;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

// Strip leading/trailing whitespace plus any ASCII control characters (C0,
// DEL, C1) and the Unicode replacement marker U+FFFD that TextDecoder emits
// when stdin holds non-UTF-8 bytes (paste artefacts, lingering ANSI escapes
// from an arrow-key press, etc.). Without this the original validator
// rejected inputs like `\x1b2` even though the operator typed `2` cleanly.
function sanitizeInput(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control bytes is exactly the point of this regex.
  return line.replace(/[\x00-\x1f\x7f-\x9f�]/g, '').trim();
}

async function ask(reader: LineReader, prompt: string, fallback: string): Promise<string> {
  process.stdout.write(prompt);
  const line = await reader.next();
  if (line === null) return fallback;
  const trimmed = sanitizeInput(line);
  return trimmed || fallback;
}

async function chooseFromList<T extends string>(
  reader: LineReader,
  label: string,
  choices: readonly T[],
  fallback: T,
): Promise<T> {
  const defaultIdx = choices.indexOf(fallback);
  const defaultLabel = defaultIdx >= 0 ? `${defaultIdx + 1}. ${fallback}` : fallback;
  const menu = choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  process.stdout.write(`${label}:\n${menu}\n`);
  while (true) {
    process.stdout.write(`Pick one [${defaultLabel}]: `);
    const line = await reader.next();
    if (line === null) return fallback;
    const raw = sanitizeInput(line);
    if (!raw) return fallback;
    const asIndex = Number.parseInt(raw, 10);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= choices.length) {
      return choices[asIndex - 1] as T;
    }
    const lower = raw.toLowerCase();
    const match = choices.find((c) => c.toLowerCase() === lower);
    if (match) return match;
    process.stderr.write(`Invalid choice: ${raw}. Enter a number 1-${choices.length} or a name.\n`);
  }
}

async function yesNo(reader: LineReader, label: string, fallback: boolean): Promise<boolean> {
  const hint = fallback ? 'Y/n' : 'y/N';
  while (true) {
    process.stdout.write(`${label} [${hint}]: `);
    const line = await reader.next();
    if (line === null) return fallback;
    const raw = sanitizeInput(line).toLowerCase();
    if (!raw) return fallback;
    if (raw === 'y' || raw === 'yes' || raw === 'true') return true;
    if (raw === 'n' || raw === 'no' || raw === 'false') return false;
    process.stderr.write('Please answer y or n.\n');
  }
}

export { KNOWN_THEMES };
export type { KnownTheme };
