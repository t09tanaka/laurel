// `@tryghost/content-api` is CJS and ships no `.d.ts`. The SDK smoke test
// (tests/sdk/content-api.test.ts) only needs the default export to be
// callable; the structural type assertions live at the call site. Keeping
// this shim local to `tests/sdk/` (rather than under a top-level `types/`
// dir) keeps the surface scoped to where the SDK is actually used.
declare module '@tryghost/content-api' {
  const GhostContentAPI: unknown;
  export default GhostContentAPI;
}
