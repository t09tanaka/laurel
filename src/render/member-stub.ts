// Defensive Proxy wrapper for the @member data frame.
//
// Laurel is members-out-of-scope: a static build has no logged-in viewer.
// Source-style themes idiomatically branch with
// `{{#unless @member}}signin{{/unless}}` / `{{@member.paid}}`. The default
// unauthenticated member is therefore a safe falsy stub: path access never
// throws, direct rendering stays empty, and Laurel's flow helpers treat it as
// falsy so the unauthenticated render remains what every visitor sees.
//
// `[components.preview].member` is the opt-in escape hatch that injects a
// synthetic member (e.g. `{paid: true, name: "Preview User"}`) so designers
// can preview the signed-in CTA against a static build. The preview object
// is a minimal shape — themes that probe richer Ghost fields like
// `@member.tier.name` or `@member.subscriptions.0.status` would otherwise
// pull `undefined` out of `tier` and trip up any JS-side helper that does
// non-null-safe chaining (Handlebars itself handles undefined chains safely,
// but helpers written in plain TS do not). Wrapping the preview member in a
// recursive Proxy that returns a falsy stub for every missing key keeps
// chained access defensively safe regardless of what the theme reaches for,
// while preserving the documented `paid` / `name` / `email` fields the
// operator opted into.
//
// The Proxy is also exposed as a standalone factory so plugins or themes
// that need to inject their own @member-shaped object can opt into the same
// safety net.
//
// Design notes:
// - The Proxy is truthy as a JS object, so the render flow helpers explicitly
//   recognise the unauthenticated stub as Handlebars-falsy. Preview members
//   are wrapped separately and remain truthy so `{{#if @member}}` still opts
//   into the signed-in branch.
// - Missing-key access returns a nested Proxy whose `[[Default]]` coerces to
//   `false` / `null` / `""` / `0`. Handlebars renders it as empty, JS-side
//   `if (member.tier)` evaluates to true (it's still an object), but
//   `member.tier === null` is false. To make `member.anything` itself read
//   as null-ish in JS comparisons we expose a `valueOf` returning `null`.
//   That is enough for `{{#if @member.tier}}` to render the falsy branch
//   under Handlebars' `Utils.isEmpty` because the proxy reports `length: 0`
//   and serialises to `""`.

const STUB_SENTINEL = Symbol('laurel.memberStubSentinel');

export interface MemberPlan {
  [key: string]: unknown;
  currency_symbol?: string;
  interval?: string;
}

export interface MemberSubscription {
  [key: string]: unknown;
  cancel_at_period_end?: boolean;
  current_period_end?: string;
  plan?: MemberPlan;
}

export interface Member {
  [key: string]: unknown;
  paid?: boolean;
  name?: string;
  email?: string;
  default_payment_card_last4?: string;
  subscriptions?: MemberSubscription[];
}

interface MemberStubInternal {
  readonly [STUB_SENTINEL]: true;
}

// Returns a "safe falsy" Proxy: any property access yields another stub of
// the same shape, so `stub.tier.name.whatever` never throws. Coercion paths
// (`valueOf`, `toString`, `Symbol.toPrimitive`) all return falsy primitives
// so `{{#if stub}}` renders the unset branch under Handlebars' isEmpty check
// (which treats `""` / `0` / falsy as empty).
function makeFalsyStub(): MemberStubInternal {
  // Non-frozen, extensible target so the `getOwnPropertyDescriptor` trap can
  // return synthesised own-property descriptors without violating Proxy
  // invariants (which require own descriptors to be consistent with the
  // underlying target unless the target is extensible).
  const target: Record<string | symbol, unknown> = Object.create(null);
  // Forward-reference container so the Proxy's `get` and
  // `getOwnPropertyDescriptor` traps can return the same recursive stub
  // Handlebars expects to see as an own-property value. We could not use a
  // `let` + post-assignment pattern because biome's `useConst` rule flags
  // the single assignment; wrapping the self-reference in a holder keeps the
  // pattern lint-clean while preserving the recursive identity.
  const self: { stub: MemberStubInternal } = { stub: null as unknown as MemberStubInternal };
  self.stub = new Proxy(target, {
    get(_t, prop) {
      if (prop === STUB_SENTINEL) return true;
      if (prop === Symbol.toPrimitive) {
        return (hint: string) => {
          if (hint === 'number') return 0;
          return '';
        };
      }
      if (prop === 'valueOf') return () => null;
      if (prop === 'toString') return () => '';
      if (prop === 'toJSON') return () => null;
      // Handlebars escapeExpression checks `value.toHTML` before falling back
      // to `toString`; returning a truthy non-callable here makes it try to
      // call `.toHTML()` and crash with "toHTML is not a function". We return
      // `undefined` so Handlebars takes the `toString` path and renders "".
      if (prop === 'toHTML') return undefined;
      // Same defensive carve-outs for Handlebars' SafeString detection so
      // chained-access leaves render as a plain empty string rather than as
      // a coerced "[object Object]" or a thrown TypeError.
      if (prop === Symbol.toStringTag) return undefined;
      // `length` so Handlebars' isEmpty (which checks Array.isArray + length)
      // does not pick up the stub as a non-empty array. We are not an array,
      // but exposing `length: 0` is harmless and makes `{{#each stub}}` render
      // nothing if a theme misuses it.
      if (prop === 'length') return 0;
      // Iterator hook so `{{#each stub}}` is a no-op rather than a crash.
      if (prop === Symbol.iterator) {
        return function* () {
          // intentionally empty
        };
      }
      return self.stub;
    },
    has(_t, prop) {
      // Handlebars strict mode checks `name in obj` before reading every path
      // segment. The unauthenticated stub intentionally accepts arbitrary
      // string keys so `@member.paid` and deeper paths resolve to the same
      // empty stub instead of throwing.
      return typeof prop === 'string';
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      // Plant the synthesised own-property descriptor on the underlying
      // extensible target so its result is invariant-compatible. This is a
      // one-time mutation per missing key (idempotent); it never invalidates
      // an existing real property because we only land here when the prop is
      // not already on the target.
      if (!Object.prototype.hasOwnProperty.call(target, prop)) {
        Object.defineProperty(target, prop, {
          value: self.stub,
          writable: false,
          enumerable: false,
          configurable: true,
        });
      }
      return Object.getOwnPropertyDescriptor(target, prop);
    },
  }) as unknown as MemberStubInternal;
  return self.stub;
}

export function createUnauthenticatedMember(): Member {
  return makeFalsyStub() as unknown as Member;
}

// Wraps an opt-in preview-member object so missing-key access returns the
// shared falsy stub instead of `undefined` (which crashes chained JS access
// in helpers that don't null-check defensively). Known fields on the input
// pass through untouched so themes that read `@member.paid` / `@member.name`
// / `@member.email` see the operator's configured values verbatim.
//
// Handlebars 4.x runs a prototype-access guard that calls
// `Object.getOwnPropertyDescriptor` on every property read and emits a noisy
// "Access has been denied" warning when a key isn't an own property. Without
// special handling our Proxy would trip that guard for every missing key on
// every render. The `getOwnPropertyDescriptor` trap below reports missing
// keys as enumerable own properties (carrying the shared falsy stub) so the
// guard sees them as legitimate own data and stays quiet, while keeping
// `ownKeys` honest (only operator-configured keys enumerate under
// `Object.keys` / `for…in`).
export function wrapMemberStub<T extends Record<string, unknown>>(member: T): T {
  return wrapMemberObject(member, makeFalsyStub(), new WeakMap<object, unknown>());
}

function wrapMemberObject<T extends Record<string, unknown>>(
  member: T,
  falsyStub: MemberStubInternal,
  seen: WeakMap<object, unknown>,
): T {
  const cached = seen.get(member);
  if (cached) return cached as T;
  // Shadow target carrying synthesised missing-key descriptors so the
  // `getOwnPropertyDescriptor` trap stays invariant-compatible. We could not
  // plant descriptors directly on `member` because the caller may have frozen
  // it (and we should not mutate user data anyway). The shadow only carries
  // descriptors for keys the wrapper has been asked about; reads still go
  // through the real `member` first via the `get` trap.
  const shadow: Record<string, unknown> = {};
  const proxy = new Proxy(member, {
    get(target, prop, receiver) {
      // Don't shadow the well-known coercion hooks on the underlying object —
      // a Proxy with a custom `valueOf` would break `Object.is(member, member)`
      // comparisons against the wrapped instance.
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      if (prop in target)
        return wrapMemberValue(Reflect.get(target, prop, receiver), falsyStub, seen);
      // Missing key → safe falsy stub. Chained access (`member.tier.name`)
      // walks the stub recursively and resolves to `""` at the leaf.
      return falsyStub;
    },
    has(target, prop) {
      // `'foo' in member` only true for keys the operator explicitly set;
      // missing keys must report false so `{{#if (lookup @member "foo")}}`
      // branches as unset.
      return Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      if (own) return own;
      if (typeof prop === 'symbol') return undefined;
      // Cache the synthesised descriptor on the shadow target so the Proxy
      // invariant ("descriptor of an extensible target's own data property
      // must be consistent across calls") is satisfied across repeated reads.
      // Handlebars' prototype-access guard checks this for every property
      // read, so without the cache a fresh descriptor would be reported each
      // time and trip the invariant.
      if (!Object.prototype.hasOwnProperty.call(shadow, prop)) {
        Object.defineProperty(shadow, prop, {
          value: falsyStub,
          writable: false,
          enumerable: false,
          configurable: true,
        });
      }
      return Object.getOwnPropertyDescriptor(shadow, prop);
    },
  }) as T;
  seen.set(member, proxy);
  return proxy;
}

function wrapMemberValue(
  value: unknown,
  falsyStub: MemberStubInternal,
  seen: WeakMap<object, unknown>,
): unknown {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached) return cached;
    const wrapped = value.map((item) => wrapMemberValue(item, falsyStub, seen));
    seen.set(value, wrapped);
    return wrapped;
  }
  if (isPlainRecord(value)) return wrapMemberObject(value, falsyStub, seen);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Exposed so tests / plugins can detect a stub branch without depending on
// the Proxy identity. `isMemberStubLeaf(value)` returns true for the falsy
// stub returned by missing-key access, false for the wrapped preview member
// itself (which carries the operator's real fields).
export function isMemberStubLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  try {
    return (value as MemberStubInternal)[STUB_SENTINEL] === true;
  } catch {
    return false;
  }
}

export const isUnauthenticatedMember = isMemberStubLeaf;
