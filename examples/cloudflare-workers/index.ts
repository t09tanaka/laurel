export interface Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, { ASSETS }: Env): Promise<Response> {
    return ASSETS.fetch(request);
  },
};
