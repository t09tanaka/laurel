import { Buffer } from 'node:buffer';
import { CliUsageError } from './parse.ts';

export async function readStdinText(hint: string): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliUsageError(`No stdin input detected. ${hint}`);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
