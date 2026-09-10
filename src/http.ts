/**
 * Cloudflare Workers does not support `redirect: "error"`, while `follow` can
 * forward authorization headers across redirects. Handle redirects manually so
 * authenticated requests never follow them.
 */
export function authenticatedRequest(input: URL | string, init: RequestInit): Request {
  return new Request(input, {
    ...init,
    redirect: 'manual',
  });
}
