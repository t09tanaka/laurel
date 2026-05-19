import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { INIT_SPEC } from '../specs.ts';

const KNOWN_THEMES = ['source', 'casper', 'edition', 'dawn', 'alto'] as const;
type KnownTheme = (typeof KNOWN_THEMES)[number];

const DEPLOY_TARGETS = ['github-pages', 'netlify', 'vercel', 'cloudflare-pages', 'custom'] as const;
type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export interface InitAnswers {
  title: string;
  url: string;
  theme: string;
  starterContent: boolean;
  rss: boolean;
  deploy: DeployTarget;
}

const DEFAULT_ANSWERS: InitAnswers = {
  title: 'My Nectar Site',
  url: 'http://localhost:4321',
  theme: 'source',
  starterContent: true,
  rss: true,
  deploy: 'github-pages',
};

export async function runInit(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(INIT_SPEC, args);
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

  let answers: InitAnswers;
  if (yes) {
    answers = { ...DEFAULT_ANSWERS };
  } else {
    try {
      answers = await promptAnswers(DEFAULT_ANSWERS);
    } catch (err) {
      process.stderr.write(
        `Failed to read answers from stdin: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
  }

  const files = renderProject(answers);
  const conflicts = files.map((f) => join(targetDir, f.path)).filter((p) => existsSync(p));
  if (conflicts.length > 0 && !force) {
    const list = conflicts.map((p) => `  ${p}`).join('\n');
    process.stderr.write(
      `Refusing to overwrite existing files:\n${list}\nPass --force to overwrite.\n`,
    );
    return 1;
  }

  for (const file of files) {
    const dest = join(targetDir, file.path);
    await ensureDir(dirnameOf(dest));
    await writeFile(dest, file.contents, 'utf8');
  }

  logger.info(`Initialised Nectar project in ${targetDir}`);
  logger.info('Next steps:');
  logger.info('  1. Drop a Ghost theme into themes/<name>/ (e.g. themes/source/).');
  logger.info('  2. Run `bunx nectar build` to render the site.');
  logger.info('  3. Run `bunx nectar serve` to preview locally.');
  return 0;
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

interface ProjectFile {
  path: string;
  contents: string;
}

export function renderProject(answers: InitAnswers): ProjectFile[] {
  const files: ProjectFile[] = [
    { path: 'nectar.toml', contents: renderConfig(answers) },
    { path: '.gitignore', contents: renderGitignore() },
    { path: 'README.md', contents: renderReadme(answers) },
  ];
  if (answers.starterContent) {
    files.push({
      path: 'content/posts/welcome.md',
      contents: renderWelcomePost(answers),
    });
    files.push({
      path: 'content/pages/about.md',
      contents: renderAboutPage(answers),
    });
    files.push({
      path: 'content/authors/default.md',
      contents: renderDefaultAuthor(),
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
  return ['node_modules/', 'dist/', '.worktrees/', '.DS_Store', ''].join('\n');
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
  lines.push('```sh');
  lines.push('bun install');
  lines.push('bunx nectar build');
  lines.push('bunx nectar serve');
  lines.push('```');
  lines.push('');
  lines.push('## Project layout');
  lines.push('');
  lines.push('- `nectar.toml` — site config (title, theme, components).');
  lines.push('- `content/posts/` — Markdown posts with YAML frontmatter.');
  lines.push('- `content/pages/` — Static pages (about, contact, …).');
  lines.push('- `content/authors/` — Author metadata.');
  lines.push(`- \`themes/${a.theme}/\` — Ghost theme used for rendering.`);
  lines.push('  Vendor a theme here before building (e.g. clone TryGhost/Source).');
  lines.push('');
  lines.push('## Deployment');
  lines.push('');
  lines.push(deploymentNotes(a.deploy));
  lines.push('');
  return lines.join('\n');
}

function deploymentNotes(target: DeployTarget): string {
  switch (target) {
    case 'github-pages':
      return [
        'Configured for **GitHub Pages**. Add a workflow (e.g.',
        '`.github/workflows/deploy.yml`) that runs `bunx nectar build` and uploads',
        '`dist/` via `actions/deploy-pages`.',
      ].join('\n');
    case 'netlify':
      return [
        'Configured for **Netlify**. Set the build command to `bunx nectar build`',
        'and the publish directory to `dist/`.',
      ].join('\n');
    case 'vercel':
      return [
        'Configured for **Vercel**. Use `bunx nectar build` as the build command',
        'and `dist` as the output directory in `vercel.json` or project settings.',
      ].join('\n');
    case 'cloudflare-pages':
      return [
        'Configured for **Cloudflare Pages**. Build command: `bunx nectar build`.',
        'Output directory: `dist`.',
      ].join('\n');
    case 'custom':
      return 'Custom deployment — wire `bunx nectar build` into your pipeline of choice.';
  }
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
  lines.push('or scaffold a new one with `bunx nectar new post "My Title"`.');
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

async function promptAnswers(defaults: InitAnswers): Promise<InitAnswers> {
  const reader = createLineReader();
  process.stdout.write('Nectar project setup — press Enter to accept defaults.\n\n');

  const title = await ask(reader, `Site title [${defaults.title}]: `, defaults.title);
  const url = await ask(reader, `Site URL [${defaults.url}]: `, defaults.url);
  const themeChoice = await chooseFromList(reader, 'Theme', [...KNOWN_THEMES], defaults.theme);
  const starter = await yesNo(
    reader,
    'Include starter content (welcome post, about page)?',
    defaults.starterContent,
  );
  const rss = await yesNo(reader, 'Enable RSS feed?', defaults.rss);
  const deploy = (await chooseFromList(
    reader,
    'Deployment target',
    [...DEPLOY_TARGETS],
    defaults.deploy,
  )) as DeployTarget;

  return {
    title,
    url,
    theme: themeChoice,
    starterContent: starter,
    rss,
    deploy,
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

async function ask(reader: LineReader, prompt: string, fallback: string): Promise<string> {
  process.stdout.write(prompt);
  const line = await reader.next();
  if (line === null) return fallback;
  const trimmed = line.trim();
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
    const raw = line.trim();
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
    const raw = line.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'y' || raw === 'yes' || raw === 'true') return true;
    if (raw === 'n' || raw === 'no' || raw === 'false') return false;
    process.stderr.write('Please answer y or n.\n');
  }
}

export { KNOWN_THEMES, DEPLOY_TARGETS };
export type { KnownTheme, DeployTarget };
