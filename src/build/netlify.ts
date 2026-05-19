import { writeHeadersFile } from './headers.ts';

export async function emitNetlifyHeaders(opts: {
  outputDir: string;
  enabled: boolean;
}): Promise<void> {
  await writeHeadersFile(opts);
}
