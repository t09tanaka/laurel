export interface GlobalFlags {
  quiet: boolean;
  verboseCount: number;
}

export interface ExtractResult {
  flags: GlobalFlags;
  rest: string[];
}

// Strips top-level verbosity flags from argv so subcommand parsers (which run
// node:util `parseArgs` in strict mode) don't choke on them. Flags may appear
// anywhere before `--`; after `--`, tokens are passed through untouched.
export function extractGlobalFlags(argv: string[]): ExtractResult {
  const rest: string[] = [];
  let quiet = false;
  let verboseCount = 0;
  let passthrough = false;

  for (const arg of argv) {
    if (passthrough) {
      rest.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      rest.push(arg);
      continue;
    }
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }
    if (arg === '--verbose') {
      verboseCount += 1;
      continue;
    }
    if (/^-V+$/.test(arg)) {
      verboseCount += arg.length - 1;
      continue;
    }
    rest.push(arg);
  }

  return { flags: { quiet, verboseCount }, rest };
}
