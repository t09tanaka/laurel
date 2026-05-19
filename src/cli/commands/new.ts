import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import slugify from 'slugify';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { NEW_SPEC } from '../specs.ts';

export async function runNew(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(NEW_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(NEW_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(NEW_SPEC));
    return 0;
  }

  const [kind, ...titleParts] = parsed.positionals;
  const title = titleParts.join(' ').trim();

  if (kind !== 'post' && kind !== 'page') {
    process.stderr.write(`Invalid kind: ${kind}. Expected "post" or "page".\n\n`);
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  if (!title) {
    process.stderr.write('A title is required.\n\n');
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  const slug = slugify(title, { lower: true, strict: true });
  const baseDir = kind === 'post' ? 'content/posts' : 'content/pages';
  const dest = join(process.cwd(), baseDir, `${slug}.md`);
  await ensureDir(dirname(dest));

  const frontmatter = ['---', `title: ${JSON.stringify(title)}`, `slug: ${slug}`];
  if (kind === 'post') {
    frontmatter.push(`date: ${new Date().toISOString()}`);
    frontmatter.push('tags: []');
    frontmatter.push('authors: []');
  }
  frontmatter.push('---', '', `# ${title}`, '', 'Write your content here.', '');

  await writeFile(dest, frontmatter.join('\n'), 'utf8');
  logger.info(`Created ${dest}`);
  return 0;
}
