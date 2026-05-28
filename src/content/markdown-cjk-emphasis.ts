import { type MarkedExtension, Tokenizer, type Tokens } from 'marked';

// CommonMark's emphasis "flanking" rules were designed for space-delimited
// scripts: a `**`/`*` run may not open when it is immediately followed by
// punctuation, nor close when immediately preceded by punctuation, unless the
// other side is whitespace/punctuation. In CJK prose a bold phrase routinely
// abuts full-width punctuation (`この「**日本の回線（主回線）**が…`), so the run
// fails to match and renders as literal asterisks.
//
// The dashboard editor relaxes this via `markdown-it-cjk-friendly`. This module
// mirrors that relaxation for the build's `marked` renderer so the static site
// and the editor agree on what counts as emphasis: a `*`/`**` run adjacent to a
// CJK character may both open and close.
//
// Scope: only `*`/`**` is broadened, never `_`/`__`. The plugin relaxes only the
// asterisk (its `canSplitWord` path) and leaves underscore at standard
// CommonMark, so we match that exactly.
//
// Implementation: rather than reimplement marked's emphasis matcher, we reuse it
// and broaden the two regexes that encode the asterisk flanking decision plus
// the opening-gate punctuation class. The CJK character set below approximates
// the East-Asian-Width detection the plugin uses — it covers the scripts and
// punctuation of real CJK prose, but is not byte-exact, so rare scripts and
// ambiguous-width characters can still differ from the editor. The two engines
// also use different matching algorithms (regex vs delimiter stack), so
// pathological unbalanced-delimiter input can differ regardless of CJK handling.

const CJK_LETTER = '\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}';
const CJK_PUNCT = '\\u3000-\\u303f\\uff01-\\uffef\\ufe30-\\ufe4f\\u2018\\u2019\\u201c\\u201d';

interface EmphasisInlineRules {
  punctuation: RegExp;
  emStrongRDelimAst: RegExp;
}

type EmStrong = (
  src: string,
  maskedSrc: string,
  prevChar?: string,
) => Tokens.Em | Tokens.Strong | undefined;

const broadenedCache = new Map<string, RegExp>();

function memo(key: string, build: () => RegExp): RegExp {
  const cached = broadenedCache.get(key);
  if (cached) return cached;
  const built = build();
  broadenedCache.set(key, built);
  return built;
}

// marked's emphasis regexes are private and version-specific (pinned to an exact
// marked release). We edit them by substring replacement, so a future marked
// change could make the target disappear. Fail loudly in that case rather than
// silently reverting to CommonMark — a silent revert would diverge from the
// editor with no error and no test signal.
function replaceOnce(source: string, target: string, replacement: string, what: string): string {
  if (!source.includes(target)) {
    throw new Error(
      `markdown-cjk-emphasis: could not find the ${what} in marked's emphasis regex. marked's internals changed — update the CJK broadening in this file.`,
    );
  }
  return source.replace(target, replacement);
}

// Let a CJK letter count as a left-side "boundary" so the opening gate in
// `emStrong` (`punctuation.exec(prevChar)`) lets a run that abuts CJK
// punctuation on its inside (`に**「…`) start looking for a close.
//
// emStrong recurses (nested inline content) while the broadened rules are
// installed, so an already-broadened regex is passed back in. Return it as-is
// then — the loud throw below is reserved for a genuine marked-internals change.
function broadenPunctuation(re: RegExp): RegExp {
  if (re.source.includes(CJK_LETTER)) return re;
  return memo(`punct:${re.flags}:${re.source}`, () => {
    const source = replaceOnce(
      re.source,
      '[\\s\\p{P}\\p{S}]',
      `[\\s\\p{P}\\p{S}${CJK_LETTER}]`,
      'punctuation class',
    );
    return new RegExp(source, re.flags);
  });
}

// A closing `*` run is rejected when preceded by punctuation and followed by a
// letter (`（主回線）**が`). Reclassify a run preceded by CJK punctuation from
// "opening only" to "can also close" by (1) excluding CJK punctuation from the
// opening-only alternative and (2) admitting it to the ambiguous one.
function broadenAstRDelim(re: RegExp): RegExp {
  if (re.source.includes(CJK_PUNCT)) return re;
  return memo(`ast:${re.flags}:${re.source}`, () => {
    const openingOnly = '(?!\\*)[\\p{P}\\p{S}\\s](\\*+)(?=[^\\p{P}\\p{S}\\s])';
    const ambiguous = '[^\\p{P}\\p{S}\\s](\\*+)(?=[^\\p{P}\\p{S}\\s])';
    let source = replaceOnce(
      re.source,
      openingOnly,
      `(?!\\*)(?![${CJK_PUNCT}])[\\p{P}\\p{S}\\s](\\*+)(?=[^\\p{P}\\p{S}\\s])`,
      'opening-only alternative',
    );
    source = replaceOnce(
      source,
      ambiguous,
      `(?:[^\\p{P}\\p{S}\\s]|[${CJK_PUNCT}])(\\*+)(?=[^\\p{P}\\p{S}\\s])`,
      'ambiguous alternative',
    );
    return new RegExp(source, re.flags);
  });
}

// Captured before any `marked.use(...)` runs, so this is marked's own matcher
// even though the extension below shadows it during a parse.
const originalEmStrong = Tokenizer.prototype.emStrong as EmStrong;

// A `marked.use(...)` extension that makes `*`/`**` emphasis CJK-friendly.
export function cjkFriendlyEmphasis(): MarkedExtension {
  return {
    tokenizer: {
      emStrong(
        src: string,
        maskedSrc: string,
        prevChar = '',
      ): Tokens.Em | Tokens.Strong | undefined {
        const self = this as unknown as Tokenizer & { rules: { inline: EmphasisInlineRules } };
        const inline = self.rules.inline;
        const punctuation = inline.punctuation;
        const ast = inline.emStrongRDelimAst;
        inline.punctuation = broadenPunctuation(punctuation);
        inline.emStrongRDelimAst = broadenAstRDelim(ast);
        try {
          return originalEmStrong.call(self, src, maskedSrc, prevChar);
        } finally {
          inline.punctuation = punctuation;
          inline.emStrongRDelimAst = ast;
        }
      },
    },
  };
}
