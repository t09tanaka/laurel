import { z } from 'zod';

const navigationItemSchema = z
  .object({
    label: z.string(),
    url: z.string(),
  })
  .strict();

export const configSchema = z
  .object({
    site: z
      .object({
        title: z.string(),
        description: z.string().default(''),
        url: z.string().default('http://localhost:4321'),
        locale: z.string().default('en'),
        timezone: z.string().default('UTC'),
        cover_image: z.string().optional(),
        logo: z.string().optional(),
        logo_width: z.number().int().positive().optional(),
        logo_height: z.number().int().positive().optional(),
        icon: z.string().optional(),
        accent_color: z.string().default('#222222'),
        twitter: z.string().optional(),
        facebook: z.string().optional(),
      })
      .strict()
      .default({ title: 'Nectar Site' }),
    theme: z
      .object({
        name: z.string().default('source'),
        dir: z.string().default('themes'),
        custom: z.record(z.unknown()).default({}),
      })
      .strict()
      .default({}),
    content: z
      .object({
        posts_dir: z.string().default('content/posts'),
        pages_dir: z.string().default('content/pages'),
        authors_dir: z.string().default('content/authors'),
        tags_dir: z.string().default('content/tags'),
        assets_dir: z.string().default('content/images'),
        visibility_policy: z.enum(['truncate', 'render-full', 'skip']).default('truncate'),
        paywall_word_count: z.number().int().positive().default(300),
      })
      .strict()
      .default({}),
    build: z
      .object({
        output_dir: z.string().default('dist'),
        base_path: z.string().default('/'),
        posts_per_page: z.number().int().positive().default(12),
        copy_content_assets: z.boolean().default(true),
      })
      .strict()
      .default({}),
    navigation: z.array(navigationItemSchema).default([]),
    secondary_navigation: z.array(navigationItemSchema).default([]),
    components: z
      .object({
        rss: z
          .object({ enabled: z.boolean().default(true), items: z.number().default(20) })
          .strict()
          .default({}),
        sitemap: z
          .object({ enabled: z.boolean().default(true) })
          .strict()
          .default({}),
        opengraph: z
          .object({
            enabled: z.boolean().default(true),
            rasterize_svg: z.boolean().default(true),
            rasterize_width: z.number().int().positive().default(1200),
          })
          .strict()
          .default({}),
        content_api: z
          .object({ enabled: z.boolean().default(true) })
          .strict()
          .default({}),
        robots: z
          .object({
            enabled: z.boolean().default(true),
            disallow: z.boolean().default(false),
          })
          .strict()
          .default({}),
        subscribe: z
          .object({
            provider: z.enum(['none', 'buttondown', 'mailchimp', 'custom']).default('none'),
            action: z.string().optional(),
            username: z.string().optional(),
            email_field_name: z.string().optional(),
          })
          .strict()
          .default({}),
        comments: z
          .object({
            provider: z
              .enum(['off', 'giscus', 'disqus', 'utterances', 'webmention.io'])
              .default('off'),
            repo: z.string().optional(),
            repo_id: z.string().optional(),
            category: z.string().optional(),
            category_id: z.string().optional(),
            mapping: z.string().optional(),
            strict: z.boolean().optional(),
            reactions_enabled: z.boolean().optional(),
            emit_metadata: z.boolean().optional(),
            input_position: z.enum(['top', 'bottom']).optional(),
            theme: z.string().optional(),
            lang: z.string().optional(),
            loading: z.enum(['lazy', 'eager']).optional(),
            issue_term: z.string().optional(),
            label: z.string().optional(),
            shortname: z.string().optional(),
            identifier: z.string().optional(),
            username: z.string().optional(),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
  })
  .strict();

export type NectarConfig = z.infer<typeof configSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
