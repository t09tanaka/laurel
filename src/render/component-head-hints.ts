import type { NectarConfig } from '~/config/schema.ts';

export type HeadHintRel = 'preconnect' | 'dns-prefetch';

export interface HeadHint {
  rel: HeadHintRel;
  href: string;
  crossorigin?: true;
}

export interface ComponentHeadHintsContext {
  readonly config: NectarConfig;
  readonly page?: { comments?: unknown };
}

interface ComponentDefinition {
  headHints?: (ctx: ComponentHeadHintsContext) => readonly HeadHint[];
}

const componentDefinitions: readonly ComponentDefinition[] = [{ headHints: commentsHeadHints }];

export function collectComponentHeadHints(ctx: ComponentHeadHintsContext): HeadHint[] {
  const seen = new Set<string>();
  const hints: HeadHint[] = [];
  for (const component of componentDefinitions) {
    const hook = component.headHints;
    if (!hook) continue;
    for (const hint of hook(ctx)) {
      const key = `${hint.rel}\0${hint.href}\0${hint.crossorigin === true ? '1' : '0'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push(hint);
    }
  }
  return hints;
}

export function commentsHeadHints(ctx: ComponentHeadHintsContext): HeadHint[] {
  if (ctx.page?.comments === false) return [];
  const cfg = ctx.config.components?.comments;
  const provider = cfg?.provider ?? 'off';
  switch (provider) {
    case 'giscus':
      return cfg?.repo
        ? [{ rel: 'preconnect', href: 'https://giscus.app', crossorigin: true }]
        : [];
    case 'utterances':
      return cfg?.repo
        ? [{ rel: 'preconnect', href: 'https://utteranc.es', crossorigin: true }]
        : [];
    case 'disqus':
      return isValidDisqusShortname(cfg?.shortname)
        ? [{ rel: 'preconnect', href: `https://${cfg.shortname}.disqus.com` }]
        : [];
    default:
      return [];
  }
}

function isValidDisqusShortname(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]+$/i.test(value);
}
