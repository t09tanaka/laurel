// Programmatic entry point for embedding Laurel's build pipeline in
// downstream tooling (Cloudflare Pages plugins, Vite integrations, custom
// build orchestrators). Import via the `laurel/build` package entry:
//   import { build } from 'laurel/build';

export { build } from './pipeline.ts';
export type { BuildOptions, BuildSummary } from './pipeline.ts';
