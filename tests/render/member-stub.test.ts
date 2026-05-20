import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import {
  createUnauthenticatedMember,
  isMemberStubLeaf,
  wrapMemberStub,
} from '~/render/member-stub.ts';

describe('wrapMemberStub (issues #489, #490)', () => {
  test('configured keys pass through verbatim', () => {
    const wrapped = wrapMemberStub({ paid: true, name: 'Alice' });
    expect(wrapped.paid).toBe(true);
    expect(wrapped.name).toBe('Alice');
  });

  test('missing-key chained access never throws', () => {
    const wrapped = wrapMemberStub({ paid: false }) as unknown as Record<string, unknown> & {
      tier: { name: string };
      subscriptions: Array<{ status: string }>;
    };
    expect(() => wrapped.tier).not.toThrow();
    expect(() => wrapped.tier.name).not.toThrow();
    expect(() => wrapped.subscriptions[0]?.status).not.toThrow();
  });

  test('missing-key leaves coerce to falsy primitives', () => {
    const wrapped = wrapMemberStub({ paid: false }) as unknown as Record<string, unknown> & {
      tier: unknown;
    };
    const leaf = wrapped.tier as { toString(): string; valueOf(): unknown };
    expect(leaf.toString()).toBe('');
    expect(leaf.valueOf()).toBe(null);
    // Stub identifies itself via the exported predicate.
    expect(isMemberStubLeaf(leaf)).toBe(true);
    expect(isMemberStubLeaf(wrapped)).toBe(false);
  });

  test('`in` operator reports only explicitly configured keys', () => {
    const wrapped = wrapMemberStub({ paid: true });
    expect('paid' in wrapped).toBe(true);
    expect('tier' in wrapped).toBe(false);
  });

  test('Handlebars chained access on missing keys renders empty', () => {
    const wrapped = wrapMemberStub({ paid: true, name: 'Alice' });
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '[{{member.paid}}][{{member.name}}][{{member.tier.name}}][{{member.subscriptions.0.status}}]',
    );
    expect(tpl({ member: wrapped })).toBe('[true][Alice][][]');
  });
});

describe('createUnauthenticatedMember (issue #974)', () => {
  test('returns a safe falsy stub for missing member path access', () => {
    const member = createUnauthenticatedMember() as unknown as Record<string, unknown> & {
      paid: unknown;
      tier: { name: unknown };
    };

    expect(isMemberStubLeaf(member)).toBe(true);
    expect(() => member.paid).not.toThrow();
    expect(() => member.tier.name).not.toThrow();
    expect(isMemberStubLeaf(member.paid)).toBe(true);
    expect(isMemberStubLeaf(member.tier.name)).toBe(true);
  });

  test('direct and chained Handlebars output stays empty in strict mode', () => {
    const member = createUnauthenticatedMember();
    const hb = Handlebars.create();
    const tpl = hb.compile('[{{member}}][{{member.paid}}][{{member.tier.name}}]', {
      strict: true,
    });
    expect(tpl({ member })).toBe('[][][]');
  });
});
