---
slug: callout
description: Aside callout box for inline asides in posts.
---

```css
.laurel-callout {
  border-left: 3px solid var(--ghost-accent-color, #d63f00);
  background: rgba(214, 63, 0, 0.04);
  padding: 14px 18px;
  margin: 24px 0;
  font-style: italic;
  border-radius: 0 4px 4px 0;
}
```

```html
<aside class="laurel-callout">
  <strong>Heads up.</strong> Drop <code>{callout}</code> into any post body to surface a tinted aside in line with the rest of the prose.
</aside>
```
