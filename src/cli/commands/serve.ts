import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';

export async function runServe(args: string[]): Promise<number> {
  const portFlag = args.indexOf('--port');
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 4321;
  const cwd = process.cwd();
  const config = await loadConfig({ cwd });
  const distDir = join(cwd, config.build.output_dir);

  if (!existsSync(distDir)) {
    logger.error(`No build output found at ${distDir}. Run \`nectar build\` first.`);
    return 1;
  }

  Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const filePath = normalize(join(distDir, target));
      if (!filePath.startsWith(distDir)) {
        return new Response('Forbidden', { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      const fallback = Bun.file(join(distDir, '404.html'));
      if (await fallback.exists()) {
        return new Response(fallback, { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  logger.info(`Serving ${distDir} on http://localhost:${port}`);
  return 0;
}
