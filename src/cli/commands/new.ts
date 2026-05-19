import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import slugify from 'slugify';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

export async function runNew(args: string[]): Promise<number> {
  const [kind, ...titleParts] = args;
  const title = titleParts.join(' ').trim();

  if (kind !== 'post' && kind !== 'page') {
    logger.error('Usage: nectar new <post|page> "Title"');
    return 2;
  }
  if (!title) {
    logger.error('A title is required');
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
