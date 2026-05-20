import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { RouteContext } from '~/render/types.ts';
import { ensureDir } from '~/util/fs.ts';
import { emitCloudflareRoutes } from '../cloudflare-routes.ts';
import {
  CloudflareWorkersManifestBuilder,
  writeCloudflareWorkersManifest,
} from '../cloudflare-workers.ts';
import { emitCustomRedirects } from '../custom-redirects.ts';
import {
  type HeaderApplication,
  type HeaderEntry,
  type HeaderRule,
  applyConfiguredHeaders,
  buildHeadersBodyFromRules,
} from '../headers.ts';
import { emitNetlifyRedirects } from '../netlify.ts';
import type { RedirectRule } from '../redirects.ts';
import { emitVercelJson } from '../vercel.ts';

export type DeploymentProvider = NonNullable<NectarConfig['build']['metadata']['provider']>;

export interface DeploymentArtifacts {
  outputDir: string;
  config: NectarConfig;
  routes: readonly RouteContext[];
  userRedirects: readonly RedirectRule[];
  deployRedirects: readonly RedirectRule[];
  autoNoindexProvider?: DeploymentProvider | undefined;
}

export interface DeployTarget {
  name: string;
  emit(ctx: DeploymentArtifacts): Promise<void> | void;
}

export interface DeployHeaderApplication extends HeaderApplication {
  flush(): Promise<void> | void;
}

export interface DeployHeaderTarget {
  name: string;
  createApplication(ctx: DeploymentArtifacts): DeployHeaderApplication | undefined;
}

export class DeployTargetRegistry {
  readonly #targets: readonly DeployTarget[];

  constructor(targets: readonly DeployTarget[]) {
    this.#targets = [...targets];
  }

  list(): readonly DeployTarget[] {
    return this.#targets;
  }

  get(name: string): DeployTarget | undefined {
    return this.#targets.find((target) => target.name === name);
  }

  async emit(ctx: DeploymentArtifacts): Promise<void> {
    for (const target of this.#targets) {
      await target.emit(ctx);
    }
  }
}

export class DeployHeaderTargetRegistry {
  readonly #targets: readonly DeployHeaderTarget[];

  constructor(targets: readonly DeployHeaderTarget[]) {
    this.#targets = [...targets];
  }

  list(): readonly DeployHeaderTarget[] {
    return this.#targets;
  }

  get(name: string): DeployHeaderTarget | undefined {
    return this.#targets.find((target) => target.name === name);
  }

  async emit(ctx: DeploymentArtifacts, prependRules: readonly HeaderRule[] = []): Promise<void> {
    for (const target of this.#targets) {
      const app = target.createApplication(ctx);
      if (!app) continue;
      for (const rule of prependRules) {
        await app.applyHeaders(rule.pattern, rule.headers);
      }
      await applyConfiguredHeaders(ctx.config.deploy.headers, app);
      await app.flush();
    }
  }
}

function enabledByConfigOrNoindex(
  ctx: DeploymentArtifacts,
  provider: DeploymentProvider,
  enabled: boolean,
): boolean {
  return enabled || ctx.autoNoindexProvider === provider;
}

function createHeadersFileApplication(outputDir: string): DeployHeaderApplication {
  const rules: HeaderRule[] = [];
  return {
    applyHeaders(file: string, headers: readonly HeaderEntry[]): void {
      rules.push({
        pattern: file,
        headers: headers.map((header) => ({ ...header })),
      });
    },
    async flush(): Promise<void> {
      await ensureDir(outputDir);
      await writeFile(join(outputDir, '_headers'), buildHeadersBodyFromRules(rules));
    },
  };
}

export const deploymentHeaderTargets = new DeployHeaderTargetRegistry([
  {
    name: 'cloudflare_pages_headers',
    createApplication: (ctx) =>
      enabledByConfigOrNoindex(ctx, 'cloudflare_pages', ctx.config.deploy.cloudflare_pages.enabled)
        ? createHeadersFileApplication(ctx.outputDir)
        : undefined,
  },
  {
    name: 'netlify_headers',
    createApplication: (ctx) =>
      enabledByConfigOrNoindex(ctx, 'netlify', ctx.config.deploy.netlify.enabled)
        ? createHeadersFileApplication(ctx.outputDir)
        : undefined,
  },
  {
    name: 'cloudflare_workers_headers',
    createApplication: (ctx) => {
      if (!ctx.config.deploy.cloudflare_workers.enabled) return undefined;
      const builder = new CloudflareWorkersManifestBuilder(ctx.deployRedirects);
      return {
        applyHeaders: (file, headers) => builder.applyHeaders(file, headers),
        async flush() {
          await writeCloudflareWorkersManifest(ctx.outputDir, builder.build());
        },
      };
    },
  },
] satisfies DeployHeaderTarget[]);

export const deploymentRoutingTargets = new DeployTargetRegistry([
  {
    name: 'cloudflare_pages_routes',
    emit: async (ctx) => {
      await emitCloudflareRoutes({
        outputDir: ctx.outputDir,
        enabled: ctx.config.deploy.cloudflare_pages.enabled,
      });
      await emitCustomRedirects({
        outputDir: ctx.outputDir,
        rules: ctx.deployRedirects,
        enabled: ctx.config.deploy.cloudflare_pages.enabled,
      });
    },
  },
  {
    name: 'netlify_redirects',
    emit: async (ctx) =>
      emitNetlifyRedirects({
        outputDir: ctx.outputDir,
        rules: ctx.deployRedirects,
        enabled: ctx.config.deploy.netlify.enabled,
      }),
  },
  {
    name: 'vercel',
    emit: async (ctx) =>
      emitVercelJson({
        outputDir: ctx.outputDir,
        enabled: enabledByConfigOrNoindex(ctx, 'vercel', ctx.config.deploy.vercel.enabled),
        headers: ctx.config.deploy.headers,
        rules: ctx.deployRedirects,
        trailingSlash: ctx.config.build.trailing_slash,
      }),
  },
] satisfies DeployTarget[]);

export async function emitDeployTargets(
  registry: DeployTargetRegistry,
  ctx: DeploymentArtifacts,
): Promise<void> {
  await registry.emit(ctx);
}

export async function emitDeployHeaders(
  registry: DeployHeaderTargetRegistry,
  ctx: DeploymentArtifacts,
  prependRules: readonly HeaderRule[] = [],
): Promise<void> {
  await registry.emit(ctx, prependRules);
}
