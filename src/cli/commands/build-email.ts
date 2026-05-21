import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveOutputDir } from '~/build/output-dir.ts';
import { loadRoutesYaml } from '~/build/routes-yaml.ts';
import { loadConfig } from '~/config/loader.ts';
import { type MarkdownTransformHook, loadContent } from '~/content/loader.ts';
import type { Post } from '~/content/model.ts';
import { createEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import { THEME_EMAIL_TEMPLATE_NAMES, loadTheme } from '~/theme/loader.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { BUILD_EMAIL_SPEC } from '../specs.ts';

export async function runBuildEmail(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(BUILD_EMAIL_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(BUILD_EMAIL_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }

  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(BUILD_EMAIL_SPEC));
    return EXIT_CODES.ok;
  }

  const postSlug = typeof parsed.values.post === 'string' ? parsed.values.post.trim() : '';
  if (postSlug.length === 0) {
    process.stderr.write('Missing required option: --post=<slug>\n\n');
    process.stderr.write(formatCommandHelp(BUILD_EMAIL_SPEC));
    return EXIT_CODES.usage;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const outputDirOverride =
    typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  const asJson = parsed.values.json === true;
  const cwd = process.cwd();

  try {
    const config = await loadConfig({ cwd, configPath });
    if (outputDirOverride !== undefined) {
      config.build.output_dir = outputDirOverride;
    }
    const routesYaml = await loadRoutesYaml(cwd);
    const markdownTransforms: MarkdownTransformHook[] = [];
    const [content, theme] = await Promise.all([
      loadContent({ cwd, config, routesYaml, includeDrafts: false, markdownTransforms }),
      loadTheme({ cwd, config }),
    ]);
    const selectedTemplate = selectEmailTemplate(theme.emailTemplates ?? {});
    if (selectedTemplate === undefined) {
      process.stderr.write(
        `Theme '${theme.name}' does not include email.hbs or email-template.hbs.\n`,
      );
      return EXIT_CODES.usage;
    }
    const post = findPostBySlug(postSlug, [...content.posts, ...content.emailOnlyPosts]);
    if (post === undefined) {
      process.stderr.write(`Post not found for --post=${postSlug}\n`);
      return EXIT_CODES.usage;
    }

    const emailTheme = {
      ...theme,
      templates: {
        ...theme.templates,
        [selectedTemplate.name]: selectedTemplate.source,
      },
    };
    const engine = createEngine({ config, content, theme: emailTheme, cwd });
    const outputDir = resolveOutputDir(cwd, config.build.output_dir);
    const outputPath = join('email', `${post.slug}.html`);
    const route: RouteContext = {
      kind: 'post',
      url: `/email/${post.slug}.html`,
      outputPath,
      template: selectedTemplate.name,
      lastmod: post.updated_at ?? post.published_at,
      indexable: false,
      data: { post },
      meta: {
        title: post.meta_title ?? post.title,
        description: post.meta_description ?? post.excerpt,
        canonical: `${config.site.url.replace(/\/+$/, '')}/email/${post.slug}.html`,
        image: post.feature_image,
      },
    };
    const html = engine.render(route);
    const absoluteOutputPath = join(outputDir, outputPath);
    await mkdir(join(outputDir, 'email'), { recursive: true });
    await writeFile(absoluteOutputPath, html, 'utf8');
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({
          event: 'build.email.done',
          ok: true,
          post: post.slug,
          template: selectedTemplate.name,
          outputPath: absoluteOutputPath,
        })}\n`,
      );
    } else {
      logger.info(`Rendered email template to ${absoluteOutputPath}`);
    }
    return EXIT_CODES.ok;
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
}

function selectEmailTemplate(
  templates: Record<string, string>,
): { name: string; source: string } | undefined {
  for (const name of THEME_EMAIL_TEMPLATE_NAMES) {
    const source = templates[name];
    if (source !== undefined) return { name, source };
  }
  return undefined;
}

function findPostBySlug(slug: string, posts: readonly Post[]): Post | undefined {
  return posts.find((post) => post.slug === slug);
}
