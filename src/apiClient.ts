/**
 * The only way this package talks to the Credda API.
 *
 * It exposes exactly one method, `get`, and the HTTP verb is a literal inside
 * it. That is deliberate and it is the enforcement point for the guarantee in
 * `src/writeSurface.test.ts`: a handler cannot start an investigation, spend a
 * model budget, or open a pull request in anybody's repository, because there
 * is no method here that would issue the request. Adding one is a visible edit
 * to this file, and the test fails on it.
 *
 * The API is the read API at `apps/api` in the engine repository. Every route
 * this client is pointed at is a `GET` there; see `README.md` for the table of
 * endpoints and where each one is defined.
 */

/** The default an operator running the engine locally already has. `docs/deploy.md` publishes it on loopback. */
export const DEFAULT_API_BASE = 'http://127.0.0.1:4317';

export type QueryValue = string | number | boolean | undefined;

export interface CreddaApi {
  /** Issue one GET against `path` (e.g. `/api/investigations`) and parse the JSON body. */
  get(path: string, query?: Record<string, QueryValue>): Promise<unknown>;
  /** The base this client reads from, for error messages. */
  readonly base: string;
}

export interface ApiClientOptions {
  apiBase?: string;
  /** Bearer key. Optional: `CREDDA_AUTH` defaults to `disabled` on a local install. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The API's error envelope is `{ error: { code, message } }` (`apps/api/src/errors.ts`).
 * A non-2xx is surfaced with that code and message rather than a bare status,
 * because "No such investigation: x" is the answer the caller needs.
 */
export class CreddaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * The parsed response body, when there was one.
     *
     * Not every non-2xx body is the error envelope, and the one that matters
     * is `/api/health`: a degraded engine answers 503 with the full readiness
     * report -- `status`, `schemaVersion`, and a `checks` array naming what
     * failed -- which has no `error` key at all. Until this field existed that
     * whole report was parsed, read for an `error.code` it does not have, and
     * dropped, leaving the caller with the string "503 from /api/health". The
     * checks are the entire reason to call the route.
     *
     * `unknown`, because this is whatever the server sent. A caller that wants
     * a shape narrows it; see `getApiHealth`.
     */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'CreddaApiError';
  }
}

export function createApiClient(options: ApiClientOptions = {}): CreddaApi {
  const base = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  return {
    base,
    async get(path, query) {
      const url = new URL(base + path);
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

      let response: Response;
      try {
        response = await doFetch(url, { method: 'GET', headers });
      } catch (cause) {
        throw new CreddaApiError(
          0,
          'UNREACHABLE',
          `Cannot reach the Credda API at ${base}. Set CREDDA_API_BASE if it runs elsewhere. (${String(cause)})`,
        );
      }

      const text = await response.text();
      let body: unknown = null;
      try {
        body = text.length === 0 ? null : JSON.parse(text);
      } catch {
        body = null;
      }

      if (!response.ok) {
        const envelope = (body as { error?: { code?: string; message?: string } } | null)?.error;
        let message = envelope?.message ?? `${String(response.status)} from ${path}`;
        /*
         * The API's own 401 text is "Bearer token required" or "Invalid API
         * key" -- accurate about what it saw, and silent about what the reader
         * has to change. The reader here is somebody who put this server in an
         * MCP client config, so the actionable half is the name of the variable
         * that config sets. Appended rather than substituted, because which of
         * the two 401s came back is the part that says whether the key is
         * missing or wrong.
         */
        if (response.status === 401) {
          message += `. Set CREDDA_API_KEY in this server's environment to a key for ${base}, or run the API with CREDDA_AUTH=disabled for a local install.`;
        }
        throw new CreddaApiError(response.status, envelope?.code ?? 'HTTP_ERROR', message, body);
      }
      return body;
    },
  };
}
