import { describe, expect, test } from 'bun:test';
import {
  LIVERELOAD_CLIENT_JS,
  LIVERELOAD_EXTERNAL_TAG,
  LIVERELOAD_INLINE_SCRIPT,
  LIVERELOAD_PATH,
  LIVERELOAD_SCRIPT_PATH,
  encodeReloadMessage,
  injectLiveReload,
} from '~/dev/livereload.ts';

describe('livereload paths', () => {
  test('LIVERELOAD_PATH lives under the /__laurel surface', () => {
    expect(LIVERELOAD_PATH.startsWith('/__laurel')).toBe(true);
  });
  test('LIVERELOAD_SCRIPT_PATH is a static .js URL', () => {
    expect(LIVERELOAD_SCRIPT_PATH).toBe('/__laurel/livereload.js');
  });
});

describe('LIVERELOAD_CLIENT_JS', () => {
  test('self-guards against duplicate injection', () => {
    expect(LIVERELOAD_CLIENT_JS).toContain('window.__laurelLiveReload');
  });
  test('opens a WebSocket on the livereload path', () => {
    expect(LIVERELOAD_CLIENT_JS).toContain(LIVERELOAD_PATH);
    expect(LIVERELOAD_CLIENT_JS).toContain('WebSocket');
  });
  test('reconnects on close so a server restart picks the browser back up', () => {
    expect(LIVERELOAD_CLIENT_JS).toMatch(/setTimeout\(connect, ?1000\)/);
  });
  test('handles CSS hot-swap branch separately from full reload', () => {
    expect(LIVERELOAD_CLIENT_JS).toContain("'css'");
    expect(LIVERELOAD_CLIENT_JS).toContain('location.reload()');
  });
});

describe('injectLiveReload', () => {
  test('inline injection lands before </body>', () => {
    const html = '<!doctype html><html><body><h1>hi</h1></body></html>';
    const out = injectLiveReload(html, 'inline');
    expect(out).toContain('__laurel_livereload');
    expect(out.indexOf('__laurel_livereload')).toBeLessThan(out.indexOf('</body>'));
  });

  test('inline injection appends when </body> is missing', () => {
    const html = '<!doctype html><p>fragment</p>';
    const out = injectLiveReload(html, 'inline');
    expect(out.startsWith(html)).toBe(true);
    expect(out.endsWith(LIVERELOAD_INLINE_SCRIPT)).toBe(true);
  });

  test('external injection emits a <script src> with defer', () => {
    const html = '<html><body>x</body></html>';
    const out = injectLiveReload(html, 'external');
    expect(out).toContain(LIVERELOAD_SCRIPT_PATH);
    expect(out).toContain('defer');
    expect(out.indexOf(LIVERELOAD_SCRIPT_PATH)).toBeLessThan(out.indexOf('</body>'));
  });

  test('external injection appends the tag when </body> is missing', () => {
    const html = '<p>fragment</p>';
    const out = injectLiveReload(html, 'external');
    expect(out.endsWith(LIVERELOAD_EXTERNAL_TAG)).toBe(true);
  });

  test('default mode is inline (backwards compat with laurel serve)', () => {
    const html = '<html><body>x</body></html>';
    const out = injectLiveReload(html);
    expect(out).toContain('__laurel_livereload');
    expect(out).not.toContain(LIVERELOAD_SCRIPT_PATH);
  });
});

describe('encodeReloadMessage', () => {
  test('round-trips through JSON.parse', () => {
    const wire = encodeReloadMessage({ type: 'reload' });
    expect(JSON.parse(wire)).toEqual({ type: 'reload' });
  });

  test('encodes css hot-swap signal', () => {
    const wire = encodeReloadMessage({ type: 'css' });
    expect(JSON.parse(wire)).toEqual({ type: 'css' });
  });
});
