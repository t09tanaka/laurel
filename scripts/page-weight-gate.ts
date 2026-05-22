import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  DEFAULT_PAGE_WEIGHT_BUDGETS,
  formatPageWeightFailures,
  summarizePageWeight,
} from '~/build/page-weight.ts';

const repoRoot = resolve(import.meta.dir, '..');
const distRoot = resolve(repoRoot, process.env.NECTAR_PAGE_WEIGHT_DIST ?? 'example/dist');

async function collectHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.nectar') return [];
        return collectHtmlFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

async function main(): Promise<void> {
  const files = await collectHtmlFiles(distRoot).catch((error) => {
    throw new Error(
      `${relative(repoRoot, distRoot)} is not ready for page-weight checks. Run "bun run build:example" first.\n${(error as Error).message}`,
    );
  });
  if (files.length === 0) {
    throw new Error(`${relative(repoRoot, distRoot)} contains no HTML files.`);
  }

  const summaries = [];
  for (const htmlFile of files) {
    summaries.push(await summarizePageWeight({ distRoot, htmlFile }));
  }
  const failures = formatPageWeightFailures(summaries, DEFAULT_PAGE_WEIGHT_BUDGETS);
  if (failures) {
    console.error('Page weight gate failed.');
    console.error(failures);
    process.exit(1);
  }
  console.log(`Page weight gate passed: ${summaries.length} page(s) within lightweight budgets.`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
