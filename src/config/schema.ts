import { z } from 'zod';

const navigationItemSchema = z.object({
  label: z.string(),
  url: z.string(),
});

export const configSchema = z.object({
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
    .default({ title: 'Nectar Site' }),
  theme: z
    .object({
      name: z.string().default('source'),
      dir: z.string().default('themes'),
      custom: z.record(z.unknown()).default({}),
    })
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
    .default({}),
  build: z
    .object({
      output_dir: z.string().default('dist'),
      base_path: z.string().default('/'),
      posts_per_page: z.number().int().positive().default(12),
      copy_content_assets: z.boolean().default(true),
    })
    .default({}),
  navigation: z.array(navigationItemSchema).default([]),
  secondary_navigation: z.array(navigationItemSchema).default([]),
  components: z
    .object({
      rss: z
        .object({ enabled: z.boolean().default(true), items: z.number().default(20) })
        .default({}),
      sitemap: z.object({ enabled: z.boolean().default(true) }).default({}),
      opengraph: z.object({ enabled: z.boolean().default(true) }).default({}),
      content_api: z.object({ enabled: z.boolean().default(true) }).default({}),
      robots: z
        .object({
          enabled: z.boolean().default(true),
          disallow: z.boolean().default(false),
        })
        .default({}),
      subscribe: z
        .object({
          provider: z.enum(['none', 'buttondown', 'mailchimp', 'custom']).default('none'),
          action: z.string().optional(),
          username: z.string().optional(),
          email_field_name: z.string().optional(),
        })
        .default({}),
    })
    .default({}),
});

export type NectarConfig = z.infer<typeof configSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
