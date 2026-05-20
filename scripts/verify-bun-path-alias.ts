import { withBasePath } from '~/util/url.ts';

const actual = withBasePath('/docs/', '/posts/hello/');
const expected = '/docs/posts/hello/';

if (actual !== expected) {
  throw new Error(`Bun failed to resolve the ~/* tsconfig path alias at runtime: ${actual}`);
}

console.log('Bun resolved ~/* from tsconfig paths at runtime.');
