import { writeFile } from 'node:fs/promises';

export const GENERATED_TEXT_LINE_ENDING = '\n';

export function normalizeGeneratedTextLineEndings(text: string): string {
  return text.replace(/\r\n?/g, GENERATED_TEXT_LINE_ENDING);
}

export async function writeGeneratedTextFile(path: string, contents: string): Promise<void> {
  await writeFile(path, normalizeGeneratedTextLineEndings(contents), 'utf8');
}
