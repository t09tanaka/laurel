import { z } from 'zod';

export const frontmatterStatusValues = ['published', 'draft', 'scheduled'] as const;
export const pageFrontmatterStatusValues = ['published', 'draft'] as const;
export const frontmatterVisibilityValues = [
  'public',
  'members',
  'paid',
  'tiers',
  'filter',
] as const;

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .describe('Kebab-case URL token. If omitted, Nectar derives it from the file name.');

const dateSchema = z
  .string()
  .describe('Quoted ISO-8601 date string such as "2026-01-02" or "2026-01-02T03:04:05Z".');

const stringListSchema = z
  .union([z.string(), z.array(z.string())])
  .describe('Either a comma-separated string or a YAML string array.');

const seoFields = {
  canonical_url: z.string().optional().describe('Canonical URL override for this entry.'),
  meta_title: z.string().optional().describe('SEO title override.'),
  meta_description: z.string().optional().describe('SEO description override.'),
  og_title: z.string().optional().describe('Open Graph title override.'),
  og_description: z.string().optional().describe('Open Graph description override.'),
  og_image: z.string().optional().describe('Open Graph image URL or content-relative path.'),
  twitter_title: z.string().optional().describe('Twitter card title override.'),
  twitter_description: z.string().optional().describe('Twitter card description override.'),
  twitter_image: z.string().optional().describe('Twitter card image URL or content-relative path.'),
} satisfies z.ZodRawShape;

const featureImageFields = {
  feature_image: z.string().optional().describe('Feature image URL or content-relative path.'),
  feature_image_alt: z.string().optional().describe('Accessible alt text for the feature image.'),
  feature_image_caption: z
    .string()
    .optional()
    .describe('Caption HTML for the feature image. Unsafe tags are stripped at load time.'),
  feature_image_width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Feature image width in px.'),
  feature_image_height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Feature image height in px.'),
} satisfies z.ZodRawShape;

const codeInjectionFields = {
  codeinjection_head: z
    .string()
    .optional()
    .describe('Raw HTML inserted into ghost_head when build.allow_code_injection is enabled.'),
  codeinjection_foot: z
    .string()
    .optional()
    .describe('Raw HTML inserted into ghost_foot when build.allow_code_injection is enabled.'),
} satisfies z.ZodRawShape;

const entryBaseFields = {
  title: z.string().describe('Entry title. Required for posts and pages.'),
  slug: slugSchema.optional(),
  date: dateSchema.optional().describe('Alias for published_at.'),
  published_at: dateSchema.optional().describe('Publication timestamp.'),
  updated_at: dateSchema.optional().describe('Last updated timestamp.'),
  created_at: dateSchema.optional().describe('Creation timestamp.'),
  status: z.enum(frontmatterStatusValues).optional().default('published'),
  tags: stringListSchema.optional(),
  author: stringListSchema.optional().describe('Single author slug or list of author slugs.'),
  authors: stringListSchema.optional().describe('Author slug list.'),
  primary_tag: slugSchema.optional().describe('Primary tag slug.'),
  primary_author: slugSchema.optional().describe('Primary author slug.'),
  custom_excerpt: z.string().optional().describe('Custom excerpt shown in listings and feeds.'),
  excerpt: z.string().optional().describe('Alias for custom_excerpt.'),
  unsafe_html: z
    .boolean()
    .optional()
    .default(false)
    .describe('Allow raw HTML in this Markdown entry before sanitization gates run.'),
  ...featureImageFields,
  ...seoFields,
  ...codeInjectionFields,
} satisfies z.ZodRawShape;

export const postFrontmatterSchema = z
  .object({
    ...entryBaseFields,
    template: slugSchema.optional().describe('Custom post template slug, with or without custom-.'),
    custom_template: slugSchema
      .optional()
      .describe('Custom post template slug, with or without custom-.'),
    visibility: z.enum(frontmatterVisibilityValues).optional().default('public'),
    featured: z.boolean().optional().default(false).describe('Mark this post as featured.'),
    email_only: z
      .boolean()
      .optional()
      .default(false)
      .describe('Exclude the post from public web routes and collections.'),
  })
  .passthrough()
  .describe('Frontmatter for content/posts/*.md.');

export const pageFrontmatterSchema = z
  .object({
    ...entryBaseFields,
    status: z.enum(pageFrontmatterStatusValues).optional().default('published'),
    template: slugSchema.optional().describe('Custom page template slug, with or without custom-.'),
    custom_template: slugSchema
      .optional()
      .describe('Custom page template slug, with or without custom-.'),
    show_title_and_feature_image: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether compatible themes should show the page title and feature image.'),
  })
  .passthrough()
  .describe('Frontmatter for content/pages/*.md.');

export const tagFrontmatterSchema = z
  .object({
    name: z.string().describe('Tag display name.'),
    slug: slugSchema.optional(),
    description: z.string().optional().describe('Tag description.'),
    feature_image: z.string().optional().describe('Tag cover image URL or content-relative path.'),
    meta_title: z.string().optional().describe('SEO title override.'),
    meta_description: z.string().optional().describe('SEO description override.'),
  })
  .passthrough()
  .describe('Frontmatter for content/tags/*.md.');

export const authorFrontmatterSchema = z
  .object({
    name: z.string().describe('Author display name.'),
    slug: slugSchema.optional(),
    bio: z.string().optional().describe('Author bio. If omitted, the Markdown body is used.'),
    profile_image: z.string().optional().describe('Profile image URL or content-relative path.'),
    cover_image: z.string().optional().describe('Cover image URL or content-relative path.'),
    website: z.string().optional().describe('Author website URL.'),
    location: z.string().optional().describe('Author location label.'),
    twitter: z.string().optional().describe('Twitter / X handle or URL.'),
    facebook: z.string().optional().describe('Facebook slug or URL.'),
    linkedin: z.string().optional().describe('LinkedIn URL.'),
    bluesky: z.string().optional().describe('Bluesky handle or URL.'),
    mastodon: z.string().optional().describe('Mastodon handle or URL.'),
    threads: z.string().optional().describe('Threads handle or URL.'),
    tiktok: z.string().optional().describe('TikTok handle or URL.'),
    youtube: z.string().optional().describe('YouTube channel URL.'),
    instagram: z.string().optional().describe('Instagram handle or URL.'),
    meta_title: z.string().optional().describe('SEO title override.'),
    meta_description: z.string().optional().describe('SEO description override.'),
  })
  .passthrough()
  .describe('Frontmatter for content/authors/*.md.');

export const frontmatterSchema = z
  .union([
    postFrontmatterSchema,
    pageFrontmatterSchema,
    tagFrontmatterSchema,
    authorFrontmatterSchema,
  ])
  .describe('Nectar YAML frontmatter for posts, pages, tags, and authors.');
