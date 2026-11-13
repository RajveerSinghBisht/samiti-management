import type { NextRequest } from 'next/server';

declare module '@/../tests/acceptance_v2/helpers' {
  export function makeJsonRequest(
    urlPath: string,
    options?: {
      method?: string;
      body?: unknown;
      cookies?: Record<string, string> | string;
      csrfToken?: string;
      headers?: Record<string, string>;
    }
  ): NextRequest;
}
