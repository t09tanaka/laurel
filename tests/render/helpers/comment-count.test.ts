import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerCommentCountHelper } from '~/render/helpers/comment-count.ts';

function makeEngine(): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: {} as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

describe('comment_count helper', () => {
  test('default render emits a wrapper span with data-ghost-comment-count and 0', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count plural="comments"}}')({});
    expect(out).toBe('<span data-ghost-comment-count>0 comments</span>');
  });

  test('honors class= hash and escapes it for attribute context', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count class="post-card-comments" plural="comments"}}')(
      {},
    );
    expect(out).toBe('<span class="post-card-comments" data-ghost-comment-count>0 comments</span>');
  });

  test('autowrap=false emits bare text without a wrapper span', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count autowrap=false plural="comments"}}')({});
    expect(out).toBe('0 comments');
  });

  test('selects singular when count is 1', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count singular="comment" plural="comments"}}')({
      comment_count: 1,
    });
    expect(out).toBe('<span data-ghost-comment-count>1 comment</span>');
  });

  test('selects plural when count is >= 2', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count singular="comment" plural="comments"}}')({
      comment_count: 5,
    });
    expect(out).toBe('<span data-ghost-comment-count>5 comments</span>');
  });

  test('uses empty when count is 0 and empty is provided', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count empty="No comments yet" plural="comments"}}')(
      {},
    );
    expect(out).toBe('<span data-ghost-comment-count>No comments yet</span>');
  });

  test('empty="" renders an empty wrapper so theme layouts can hide it via CSS', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count empty="" plural="comments"}}')({});
    expect(out).toBe('<span data-ghost-comment-count></span>');
  });

  test('falls back to plural when empty hash is omitted (Ghost parity)', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count plural="comments"}}')({});
    expect(out).toBe('<span data-ghost-comment-count>0 comments</span>');
  });

  test('supports Ghost theme empty/singular/plural labels from issue #992', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const tmpl = engine.hb.compile(
      '{{comment_count empty="" singular="comment" plural="comments"}}',
    );
    expect(tmpl({ comment_count: 0 })).toBe('<span data-ghost-comment-count></span>');
    expect(tmpl({ comment_count: 1 })).toBe('<span data-ghost-comment-count>1 comment</span>');
    expect(tmpl({ comment_count: 3 })).toBe('<span data-ghost-comment-count>3 comments</span>');
  });

  test('substitutes the % placeholder in singular/plural with the count', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const tmpl = engine.hb.compile('{{comment_count singular="% comment" plural="% comments"}}');
    expect(tmpl({ comment_count: 0 })).toBe('<span data-ghost-comment-count>0 comments</span>');
    expect(tmpl({ comment_count: 1 })).toBe('<span data-ghost-comment-count>1 comment</span>');
    expect(tmpl({ comment_count: 7 })).toBe('<span data-ghost-comment-count>7 comments</span>');
  });

  test('autowrap="false" string form also disables the wrapper (theme parity)', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count autowrap="false" plural="comments"}}')({});
    expect(out).toBe('0 comments');
  });

  test('escapes plural text against accidental HTML injection in the wrapper', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count plural=p}}')({
      p: '<script>x</script>',
    });
    expect(out).toBe('<span data-ghost-comment-count>0 &lt;script&gt;x&lt;/script&gt;</span>');
  });

  test('coerces a string comment_count on the context to a number', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count singular="% comment" plural="% comments"}}')({
      comment_count: '3',
    });
    expect(out).toBe('<span data-ghost-comment-count>3 comments</span>');
  });

  test('non-numeric / negative context values fall back to 0', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const tmpl = engine.hb.compile('{{comment_count empty="none" singular="one" plural="many"}}');
    expect(tmpl({ comment_count: 'abc' })).toBe('<span data-ghost-comment-count>none</span>');
    expect(tmpl({ comment_count: -2 })).toBe('<span data-ghost-comment-count>none</span>');
  });

  test('omitting plural and empty renders an empty wrapper rather than throwing', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    const out = engine.hb.compile('{{comment_count}}')({});
    expect(out).toBe('<span data-ghost-comment-count></span>');
  });

  test('register call installs the helper under the `comment_count` name', () => {
    const engine = makeEngine();
    registerCommentCountHelper(engine);
    // The compiled template would fall back to a missing-helper warning if the
    // name was wrong, so check the Handlebars registry directly.
    expect(typeof engine.hb.helpers.comment_count).toBe('function');
  });
});
