import { type HeadersConfig, writeHeadersFile } from './headers.ts';

export async function emitCloudflarePagesHeaders(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
}): Promise<void> {
  await writeHeadersFile(opts);
}
