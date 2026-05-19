import { describe, expect, test } from 'bun:test';
import { stripUnusedLightbox } from '~/build/lightbox.ts';

const LIGHTBOX_MARKUP = `    <div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="pswp__bg"></div>
        <div class="pswp__scroll-wrap">
            <div class="pswp__container">
                <div class="pswp__item"></div>
                <div class="pswp__item"></div>
                <div class="pswp__item"></div>
            </div>
            <div class="pswp__ui pswp__ui--hidden">
                <div class="pswp__top-bar">
                    <div class="pswp__counter"></div>
                    <div class="pswp__preloader">
                        <div class="pswp__preloader__icn">
                            <div class="pswp__preloader__cut">
                                <div class="pswp__preloader__donut"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="pswp__caption">
                    <div class="pswp__caption__center"></div>
                </div>
            </div>
        </div>
    </div>`;

function wrap(content: string, lightbox = LIGHTBOX_MARKUP): string {
  return `<body>\n<main>${content}</main>\n${lightbox}\n<script src="/x.js"></script>\n</body>`;
}

describe('stripUnusedLightbox', () => {
  test('removes the .pswp overlay when no lightboxable images are present', () => {
    const input = wrap('<p>just text</p>');
    const out = stripUnusedLightbox(input);
    expect(out).not.toContain('class="pswp"');
    expect(out).not.toContain('pswp__');
    expect(out).toContain('<script src="/x.js"></script>');
    expect(out).toContain('<p>just text</p>');
  });

  test('keeps the overlay when content has a kg-image-card', () => {
    const input = wrap(
      '<figure class="kg-card kg-image-card"><img class="kg-image" width="800" height="600" /></figure>',
    );
    expect(stripUnusedLightbox(input)).toBe(input);
  });

  test('keeps the overlay when content has a kg-gallery-image', () => {
    const input = wrap(
      '<figure class="kg-card kg-gallery-card"><div class="kg-gallery-image"><img /></div></figure>',
    );
    expect(stripUnusedLightbox(input)).toBe(input);
  });

  test('is a no-op when the markup is absent', () => {
    const input = '<body><p>no lightbox here</p></body>';
    expect(stripUnusedLightbox(input)).toBe(input);
  });

  test('handles multiple nested divs inside the overlay without over-consuming', () => {
    const trailing = '<footer>after</footer></body>';
    const input = `<body><article>x</article>\n${LIGHTBOX_MARKUP}\n${trailing}`;
    const out = stripUnusedLightbox(input);
    expect(out).not.toContain('pswp');
    expect(out).toContain('<article>x</article>');
    expect(out).toContain(trailing);
  });

  test('strips the leading indentation/newline so no orphan whitespace remains', () => {
    const input = `<div>before</div>\n${LIGHTBOX_MARKUP}\n<div>after</div>`;
    const out = stripUnusedLightbox(input);
    expect(out).toContain('<div>before</div>');
    expect(out).toContain('<div>after</div>');
    expect(out).not.toMatch(/<div>before<\/div>\n[ \t]*\n<div>after<\/div>/);
  });

  test('matches class substrings only on a word boundary', () => {
    const input = wrap('<div class="not-kg-image-cardish">x</div>');
    const out = stripUnusedLightbox(input);
    expect(out).not.toContain('class="pswp"');
  });
});
