import type { NectarConfig } from '~/config/schema.ts';
import type { RouteContext } from '~/render/types.ts';
import { emitCloudflarePagesHeaders } from '../cloudflare-pages.ts';
import { emitCloudflareRoutes } from '../cloudflare-routes.ts';
import { emitCustomRedirects } from '../custom-redirects.ts';
import { emitNetlifyHeaders, emitNetlifyRedirects } from '../netlify.ts';
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

function enabledByConfigOrNoindex(
  ctx: DeploymentArtifacts,
  provider: DeploymentProvider,
  enabled: boolean,
): boolean {
  return enabled || ctx.autoNoindexProvider === provider;
}

export const deploymentHeaderTargets = new DeployTargetRegistry([
  {
    name: 'cloudflare_pages_headers',
    emit: async (ctx) =>
      emitCloudflarePagesHeaders({
        outputDir: ctx.outputDir,
        enabled: enabledByConfigOrNoindex(
          ctx,
          'cloudflare_pages',
          ctx.config.deploy.cloudflare_pages.enabled,
        ),
        headers: ctx.config.deploy.headers,
      }),
  },
  {
    name: 'netlify_headers',
    emit: async (ctx) =>
      emitNetlifyHeaders({
        outputDir: ctx.outputDir,
        enabled: enabledByConfigOrNoindex(ctx, 'netlify', ctx.config.deploy.netlify.enabled),
        headers: ctx.config.deploy.headers,
      }),
  },
] satisfies DeployTarget[]);

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
