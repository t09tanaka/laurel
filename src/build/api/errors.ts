export interface GhostContentApiError {
  message: string;
  context: string;
  type: string;
  details: null;
  property: null;
  help: null;
  code: null;
  id: string;
}

export interface GhostContentApiErrorEnvelope {
  errors: GhostContentApiError[];
}

export function buildContentApiNotFoundEnvelope(): GhostContentApiErrorEnvelope {
  return {
    errors: [
      {
        message: 'Resource not found error, cannot read post.',
        context: 'The requested Content API resource was not found.',
        type: 'NotFoundError',
        details: null,
        property: null,
        help: null,
        code: null,
        id: 'nectar-content-api-404',
      },
    ],
  };
}
