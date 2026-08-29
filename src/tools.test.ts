/**
 * The handlers, against a fake `CreddaApi`.
 *
 * What each test pins is the PATH and the QUERY, because those are the only
 * places this package can be wrong about an API it does not own: every route
 * asserted here is a `GET` in `apps/api/src/routes/`, and a typo would be a
 * 404 a user sees rather than a test failure. Response bodies are passed
 * through untouched, so there is nothing else here to assert about them.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  listRepositories,
  listRepositoryLearnings,
  listInvestigations,
  getInvestigation,
  listInvestigationEvents,
  listInvestigationEvidence,
  listResolutions,
  getLatestResolution,
  getResolution,
  listValidations,
  getValidation,
  listValidationChecks,
  listValidationFindings,
  listValidationEvidence,
  getApiHealth,
  type ToolContext,
} from './tools.js';
import { createApiClient, CreddaApiError, DEFAULT_API_BASE } from './apiClient.js';

function fakeApi(result: unknown = { ok: true }) {
  const get = vi.fn().mockResolvedValue(result);
  const ctx: ToolContext = { api: { get, base: 'http://api.test' } };
  return { ctx, get };
}

/** The path each handler must ask for, and the query it must build. */
const cases: [string, (ctx: ToolContext) => Promise<unknown>, string, Record<string, unknown> | undefined][] = [
  ['list_repositories', (c) => listRepositories(c, { limit: 10, offset: 5 }), '/api/repositories', { limit: 10, offset: 5 }],
  [
    'list_repository_learnings',
    (c) => listRepositoryLearnings(c, { repositoryId: 'repo 1', kind: 'INVARIANT', limit: 2 }),
    '/api/repositories/repo%201/learnings',
    { kind: 'INVARIANT', limit: 2, offset: undefined },
  ],
  [
    'list_investigations',
    (c) => listInvestigations(c, { state: 'COMPLETED' }),
    '/api/investigations',
    { state: 'COMPLETED', limit: undefined, offset: undefined },
  ],
  ['get_investigation', (c) => getInvestigation(c, { investigationId: 'inv_1' }), '/api/investigations/inv_1', undefined],
  [
    'list_investigation_events',
    (c) => listInvestigationEvents(c, { investigationId: 'inv_1', since: 12, limit: 100, includeDebug: true }),
    '/api/investigations/inv_1/events',
    { since: 12, limit: 100, includeDebug: true },
  ],
  [
    'list_investigation_evidence',
    (c) => listInvestigationEvidence(c, { investigationId: 'inv_1', type: 'LOG' }),
    '/api/investigations/inv_1/evidence',
    { type: 'LOG', limit: undefined, offset: undefined },
  ],
  [
    'list_resolutions',
    (c) => listResolutions(c, { investigation: 'inv_1', signal: 'sig_1', confidence: 'PARTIALLY_ESTABLISHED' }),
    '/api/resolutions',
    { investigation: 'inv_1', signal: 'sig_1', confidence: 'PARTIALLY_ESTABLISHED', limit: undefined, offset: undefined },
  ],
  [
    'get_latest_resolution',
    (c) => getLatestResolution(c, { investigationId: 'inv_1' }),
    '/api/resolutions/latest',
    { investigation: 'inv_1' },
  ],
  ['get_resolution', (c) => getResolution(c, { resolutionId: 'res_1' }), '/api/resolutions/res_1', undefined],
  [
    'list_validations',
    (c) => listValidations(c, { repository: 'repo_1', state: 'COMPLETED', outcome: 'PASSED' }),
    '/api/validations',
    { repository: 'repo_1', state: 'COMPLETED', outcome: 'PASSED', limit: undefined, offset: undefined },
  ],
  ['get_validation', (c) => getValidation(c, { validationId: 'val_1' }), '/api/validations/val_1', undefined],
  [
    'list_validation_checks',
    (c) => listValidationChecks(c, { validationId: 'val_1', limit: 3 }),
    '/api/validations/val_1/checks',
    { limit: 3, offset: undefined },
  ],
  [
    'list_validation_findings',
    (c) => listValidationFindings(c, { validationId: 'val_1' }),
    '/api/validations/val_1/findings',
    { limit: undefined, offset: undefined },
  ],
  [
    'list_validation_evidence',
    (c) => listValidationEvidence(c, { validationId: 'val_1' }),
    '/api/validations/val_1/evidence',
    { limit: undefined, offset: undefined },
  ],
  ['get_api_health', (c) => getApiHealth(c), '/api/health', undefined],
];

describe('every handler reads the route it claims', () => {
  it.each(cases)('%s', async (_name, call, path, query) => {
    const { ctx, get } = fakeApi();
    await call(ctx);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(path);
    expect(get.mock.calls[0][1]).toEqual(query);
  });

  it('returns the API body untouched', async () => {
    const body = { investigations: [{ id: 'inv_1' }], total: 1 };
    const { ctx } = fakeApi(body);
    expect(await listInvestigations(ctx)).toBe(body);
  });

  it('encodes an id so a path separator in it cannot reach another route', async () => {
    const { ctx, get } = fakeApi();
    await getInvestigation(ctx, { investigationId: '../../repositories' });
    expect(get.mock.calls[0][0]).toBe('/api/investigations/..%2F..%2Frepositories');
  });
});

describe('the API client', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;

  it('defaults to the loopback address a local install publishes', () => {
    expect(createApiClient().base).toBe(DEFAULT_API_BASE);
    expect(DEFAULT_API_BASE).toBe('http://127.0.0.1:4317');
  });

  it('sends a GET with the bearer key and omits undefined query values', async () => {
    const fetchImpl = respond(200, { ok: true });
    const api = createApiClient({ apiBase: 'http://api.test/', apiKey: 'secret', fetchImpl });
    await api.get('/api/investigations', { state: 'COMPLETED', limit: undefined });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('http://api.test/api/investigations?state=COMPLETED');
    expect(init.method).toBe('GET');
    expect(init.headers.authorization).toBe('Bearer secret');
    expect(init.body).toBeUndefined();
  });

  it('sends no Authorization header when no key is configured', async () => {
    const fetchImpl = respond(200, {});
    await createApiClient({ apiBase: 'http://api.test', fetchImpl }).get('/api/health');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
  });

  it("surfaces the API's own error code and message, not a bare status", async () => {
    const api = createApiClient({
      apiBase: 'http://api.test',
      fetchImpl: respond(404, { error: { code: 'NOT_FOUND', message: 'No such investigation: inv_9' } }),
    });
    await expect(api.get('/api/investigations/inv_9')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'No such investigation: inv_9',
    });
  });

  it('names the variable to set when the API rejects the key', async () => {
    // The API's own 401 text says what it saw and not what to change. The
    // reader is somebody editing an MCP client config, so the message has to
    // carry the variable name that config sets.
    const api = createApiClient({
      apiBase: 'http://api.test',
      apiKey: 'wrong',
      fetchImpl: respond(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid API key' } }),
    });
    const err = (await api.get('/api/health').catch((e: unknown) => e)) as CreddaApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    // The API's own words survive; the guidance is appended, not substituted.
    expect(err.message).toContain('Invalid API key');
    expect(err.message).toContain('CREDDA_API_KEY');
    expect(err.message).toContain('http://api.test');
  });

  it('leaves a non-401 message exactly as the API wrote it', async () => {
    const api = createApiClient({
      apiBase: 'http://api.test',
      fetchImpl: respond(403, { error: { code: 'FORBIDDEN', message: 'Not your organisation' } }),
    });
    const err = (await api.get('/api/health').catch((e: unknown) => e)) as CreddaApiError;
    expect(err.message).toBe('Not your organisation');
  });

  it('says where it tried to reach when the API is not running', async () => {
    const api = createApiClient({
      apiBase: 'http://api.test',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const err = await api.get('/api/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreddaApiError);
    expect((err as CreddaApiError).code).toBe('UNREACHABLE');
    expect((err as CreddaApiError).message).toContain('http://api.test');
  });
});
