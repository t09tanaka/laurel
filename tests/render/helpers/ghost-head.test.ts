import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { ContentGraph, SiteData } from '~/content/model.ts';
import type { NectarEngine } from '~/render/engine.ts';
import { registerGhostHeadFootHelpers } from '~/render/helpers/ghost-head.ts';

function makeEngine(site: Partial<SiteData> = {}): NectarEngine {
  const hb = Handlebars.create();
  const fullSite: SiteData = {
    title: 'Nectar Test',
    description: 'desc',
    url: 'https://example.com',
    locale: 'en',
    timezone: 'UTC',
    cover_image: undefined,
    logo: undefined,
    icon: undefined,
    accent_color: '#000',
    navigation: [],
    secondary_navigation: [],
    lang: 'en',
    twitter: undefined,
    facebook: undefined,
    ...site,
  };
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: { site: fullSite } as unknown as ContentGraph,
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

function renderGhostHead(ctx: Record<string, unknown>, routeUrl = '/some-post/'): string {
  const engine = makeEngine();
  registerGhostHeadFootHelpers(engine);
  const template = engine.hb.compile('{{{ghost_head}}}');
  return template(ctx, {
    data: {
      route: { url: routeUrl, data: { post: ctx } },
    },
  });
}

function extractJsonLd(html: string): string {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`no JSON-LD found in: ${html}`);
  return match[1];
}

describe('ghost_head JSON-LD escaping', () => {
  test('escapes </script> in post title so it cannot break out of the script tag', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Evil </script><script>alert(1)</script>',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    // Only the outer </script> closing the JSON-LD block may appear; the payload must be escaped.
    const closings = html.match(/<\/script>/g) ?? [];
    expect(closings.length).toBe(1);
    expect(html).not.toContain('</script><script>alert(1)');

    const jsonLd = extractJsonLd(html);
    expect(jsonLd).toContain('\\u003C/script\\u003E');
    // Parsing the escaped payload back through JSON must restore the original title.
    const parsed = JSON.parse(jsonLd) as { headline: string };
    expect(parsed.headline).toBe('Evil </script><script>alert(1)</script>');
  });

  test('escapes <, >, & in JSON-LD payload', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A & B < C > D',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const jsonLd = extractJsonLd(html);
    expect(jsonLd).not.toMatch(/[<>&]/);
    expect(jsonLd).toContain('\\u0026');
    expect(jsonLd).toContain('\\u003C');
    expect(jsonLd).toContain('\\u003E');
    const parsed = JSON.parse(jsonLd) as { headline: string };
    expect(parsed.headline).toBe('A & B < C > D');
  });

  test('escapes U+2028 / U+2029 which are valid JSON but invalid JS string literals', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'line sep ok',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const jsonLd = extractJsonLd(html);
    expect(jsonLd).not.toContain(' ');
    expect(jsonLd).not.toContain(' ');
    expect(jsonLd).toContain('\\u2028');
    expect(jsonLd).toContain('\\u2029');
  });
});
