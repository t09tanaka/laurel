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
// and the editor agree on what counts as emphasis. The rule, matching the
// CommonMark CJK draft the plugin implements: a delimiter run adjacent to a CJK
// character may both open and close.
//
// Rather than reimplement marked's emphasis matcher, we reuse it and only
// broaden the three regexes that encode the flanking decision. Parity with the
// plugin is exact for realistic prose; on pathological unbalanced-delimiter
// input the two engines can still differ, which is inherent to marked and
// markdown-it using different matching algorithms (the same input already
// diverges before this change).

const CJK_LETTER = '\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}';
const CJK_PUNCT = '\\u3000-\\u303f\\uff01-\\uffef\\ufe30-\\ufe4f\\u2018\\u2019\\u201c\\u201d';

interface EmphasisInlineRules {
  punctuation: RegExp;
  emStrongRDelimAst: RegExp;
  emStrongRDelimUnd: RegExp;
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

// Let a CJK letter count as a left-side "boundary" so the opening gate in
// `emStrong` (`punctuation.exec(prevChar)`) lets a run that abuts CJK
// punctuation on its inside (`に**「…`) start looking for a close.
function broadenPunctuation(re: RegExp): RegExp {
  return memo(`punct:${re.source}`, () => {
    const source = re.source.replace('[\\s\\p{P}\\p{S}]', `[\\s\\p{P}\\p{S}${CJK_LETTER}]`);
    return new RegExp(source, re.flags);
  });
}

// A closing delimiter is rejected when preceded by punctuation and followed by
// a letter (`（主回線）**が`). We reclassify a run preceded by CJK punctuation
// from "opening only" to "can also close" by (1) excluding CJK punctuation from
// the opening-only alternative and (2) admitting it to the ambiguous one.
function broadenRDelim(re: RegExp, marker: '*' | '_'): RegExp {
  return memo(`${marker}:${re.source}`, () => {
    const m = marker === '*' ? '\\*' : '_';
    const openingOnly = `(?!${m})[\\p{P}\\p{S}\\s](${m}+)(?=[^\\p{P}\\p{S}\\s])`;
    const ambiguous = `[^\\p{P}\\p{S}\\s](${m}+)(?=[^\\p{P}\\p{S}\\s])`;
    const source = re.source
      .replace(
        openingOnly,
        `(?!${m})(?![${CJK_PUNCT}])[\\p{P}\\p{S}\\s](${m}+)(?=[^\\p{P}\\p{S}\\s])`,
      )
      .replace(ambiguous, `(?:[^\\p{P}\\p{S}\\s]|[${CJK_PUNCT}])(${m}+)(?=[^\\p{P}\\p{S}\\s])`);
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
        const und = inline.emStrongRDelimUnd;
        inline.punctuation = broadenPunctuation(punctuation);
        inline.emStrongRDelimAst = broadenRDelim(ast, '*');
        inline.emStrongRDelimUnd = broadenRDelim(und, '_');
        try {
          return originalEmStrong.call(self, src, maskedSrc, prevChar);
        } finally {
          inline.punctuation = punctuation;
          inline.emStrongRDelimAst = ast;
          inline.emStrongRDelimUnd = und;
        }
      },
    },
  };
}
