// Programmatic entry point for embedding Nectar's build pipeline in
// downstream tooling (Cloudflare Pages plugins, Vite integrations, custom
// build orchestrators). Import via the `nectar/build` package entry:
//   import { build } from 'nectar/build';

export { build } from './pipeline.ts';
export type { BuildOptions, BuildSummary } from './pipeline.ts';
