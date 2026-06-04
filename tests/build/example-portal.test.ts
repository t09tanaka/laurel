import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';
import { PORTAL_RUNTIME_JS, PORTAL_RUNTIME_PATH } from '~/build/portal-runtime.ts';

// Issue #494: the vendored Source theme ships `data-portal="signup"` /
// `data-portal="signin"` / `data-portal="account"` markup inside the
// navigation partial, gated behind `{{#if @site.members_enabled}}`. When the
// operator enables `[components.portal]`, Laurel's render path must keep that
// markup intact (or rewrite anchors / promote buttons to anchors per
// `portal-shim.ts`) so themes wired against Ghost Portal still show their
// sign-in CTAs against a static build. This test copies the example site,
// flips `[components.portal].provider = "ghost"`, builds, and asserts the
// rendered home page carries the expected portal triggers.
describe('example build with portal enabled (#494)', () => {
  test('Source navigation portal markup survives a default laurel build', async () => {
    const exampleDir = join(process.cwd(), 'example');
    const cwd = await mkdtemp(join(tmpdir(), 'laurel-example-portal-'));
    // Copy the full example tree so theme + content + assets resolve the
    // same way they do for the canonical `bun ../src/cli/index.ts build`.
    await cp(exampleDir, cwd, { recursive: true });

    // Write a portal-enabled config on top of the copied tree. We use
    // `provider = "ghost"` because that's the canonical Ghost-compat path:
    // markup is preserved verbatim (no href rewrite), so the test asserts
    // the simplest pass-through contract.
    const originalConfig = await readFile(join(exampleDir, 'laurel.toml'), 'utf8');
    await writeFile(
      join(cwd, 'laurel.toml'),
      `${originalConfig}\n[components.portal]\nprovider = "ghost"\n`,
      'utf8',
    );

    const summary = await build({ cwd });
    expect(summary.routeCount).toBeGreaterThan(0);

    const indexHtml = await readFile(join(summary.outputDir, 'index.html'), 'utf8');
    // The navigation partial wires Sign in / Subscribe through Ghost Portal:
    // those triggers must appear in the rendered home page so an injected
    // Portal client script can attach behaviour to them.
    expect(indexHtml).toContain('data-portal="signin"');
    expect(indexHtml).toContain('data-portal="signup"');
    // The href stays as Ghost's portal hash because `provider = "ghost"`
    // routes through the Portal client at runtime instead of being
    // rewritten at build time.
    expect(indexHtml).toMatch(/href="#\/portal\/signin"/);
    // `@site.members_enabled` was opted in via the portal block, so the
    // sign-in UI surface in nav is present (and not stubbed out by the
    // `{{#if @site.members_enabled}}` guard).
    expect(indexHtml).toMatch(/data-portal="(signin|signup)"/);
    expect(indexHtml).toContain('window.LaurelPortal=');
    expect(indexHtml).toContain('src="/assets/laurel-portal.js?v=');
    expect(await readFile(join(summary.outputDir, PORTAL_RUNTIME_PATH), 'utf8')).toBe(
      PORTAL_RUNTIME_JS,
    );
  });

  test('external provider rewrites portal buttons to the provider URL', async () => {
    const exampleDir = join(process.cwd(), 'example');
    const cwd = await mkdtemp(join(tmpdir(), 'laurel-example-portal-rewrite-'));
    await cp(exampleDir, cwd, { recursive: true });

    const originalConfig = await readFile(join(exampleDir, 'laurel.toml'), 'utf8');
    await writeFile(
      join(cwd, 'laurel.toml'),
      `${originalConfig}\n[components.portal]\nprovider = "buttondown"\npublication = "laurel-demo"\n`,
      'utf8',
    );

    const summary = await build({ cwd });
    const indexHtml = await readFile(join(summary.outputDir, 'index.html'), 'utf8');
    // Buttondown's inferred signup URL must replace Ghost's dead
    // `#/portal/signup` href on the Subscribe anchor.
    expect(indexHtml).toMatch(/href="https:\/\/buttondown\.email\/laurel-demo"/);
    // The original Ghost-default hash href must not still be on the anchor —
    // otherwise both attributes would coexist and clients would pick the
    // first one (typically the dead one).
    expect(indexHtml).not.toMatch(/<a[^>]*href="#\/portal\/signup"[^>]*data-portal="signup"/);
    // `data-portal` markers stay on the rewritten anchors so a Portal client
    // wired up by the embedder can still locate them.
    expect(indexHtml).toContain('data-portal="signup"');
  });
});
