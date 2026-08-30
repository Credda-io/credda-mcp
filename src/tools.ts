/**
 * Pure tool handlers: no MCP SDK types here, so they are testable against a
 * fake `CreddaApi`. `src/server.ts` wires these into MCP tool registrations
 * (names, schemas, titles, descriptions).
 *
 * EVERY HANDLER IN THIS FILE IS A READ. There is no handler that starts an
 * investigation, spends a model budget, writes to a repository, or opens a
 * pull request, and `src/apiClient.ts` has no method that could issue such a
 * request. The API has two write routes -- `POST /api/investigations` and
 * `POST /api/investigations/{id}/cancel` (`apps/api/src/routes/investigations.ts`)
 * -- and this package deliberately wraps neither. See `src/writeSurface.test.ts`,
 * which fails if that changes, and `src/routeSurface.test.ts`, which holds those
 * two exclusions to a stated reason rather than to silence.
 *
 * ⚠️ EVERYTHING THESE TOOLS RETURN IS UNTRUSTED INPUT. Issue titles and bodies,
 * evidence summaries, log excerpts, diffs and check output all originate in a
 * customer's repository or in a report somebody filed, and they arrive in a
 * model's context verbatim. Nothing in this package sanitises them, and no
 * sanitiser is claimed. What limits the damage is the shape of the surface: a
 * model that is talked into "now open a pull request" finds no tool here that
 * can, because there is none.
 */

import type { CreddaApi, QueryValue } from './apiClient.js';

export interface ToolContext {
  api: CreddaApi;
}

/** A page window. Both are validated by the API (`limit` 1..100, `offset` >= 0). */
export interface PageArgs {
  limit?: number;
  offset?: number;
}

function page(args: PageArgs): Record<string, QueryValue> {
  return { limit: args.limit, offset: args.offset };
}

// ── Repositories ─────────────────────────────────────────────────────────────

/** `GET /api/repositories`. The repositories the calling key's organisation has. */
export async function listRepositories(ctx: ToolContext, args: PageArgs = {}) {
  return ctx.api.get('/api/repositories', page(args));
}

/**
 * `GET /api/repositories/:id`. One repository, resolved from an id.
 *
 * Every investigation and validation row this server returns carries a
 * `repositoryId`, and until this route existed resolving one meant paging
 * {@link listRepositories} until the id turned up.
 */
export async function getRepository(ctx: ToolContext, args: { repositoryId: string }) {
  return ctx.api.get(`/api/repositories/${encodeURIComponent(args.repositoryId)}`);
}

/**
 * `GET /api/repositories/:id/learnings`. What Credda has learned about this
 * repository across investigations. An empty list is a real answer: it means
 * nothing has been learned here yet, not that the repository is unknown.
 */
export async function listRepositoryLearnings(
  ctx: ToolContext,
  args: PageArgs & { repositoryId: string; kind?: string },
) {
  return ctx.api.get(`/api/repositories/${encodeURIComponent(args.repositoryId)}/learnings`, {
    kind: args.kind,
    ...page(args),
  });
}

// ── Investigations ───────────────────────────────────────────────────────────

/**
 * `GET /api/investigations`. The queue, newest first, with a `total`.
 *
 * `repository` and `outcome` are filters the route has always accepted and this
 * tool did not pass, so the two questions most often asked of a queue -- whose
 * repository, and how did it end -- could not be asked at all. The sibling
 * {@link listValidations} carried its full set throughout.
 *
 * `signal` is the only way to ask for every investigation one signal caused.
 * Filtering `/api/resolutions` by the same signal shows only the runs that
 * produced a record, which hides exactly the runs that resolved nothing.
 *
 * `hasSignal` asks the question `signal` cannot: whether a run was raised by a
 * reported failure at all. With `total` counted under the filter, one call with
 * `limit: 1` is the exact count over the organisation, where a caller otherwise
 * paged the queue and counted rows -- a floor of one page, never a total. The
 * engine refuses it alongside `signal` with a 400, because the two narrow one
 * column; ask one or the other.
 */
export async function listInvestigations(
  ctx: ToolContext,
  args: PageArgs & {
    repository?: string;
    signal?: string;
    hasSignal?: boolean;
    state?: string;
    outcome?: string;
  } = {},
) {
  return ctx.api.get('/api/investigations', {
    repository: args.repository,
    signal: args.signal,
    hasSignal: args.hasSignal,
    state: args.state,
    outcome: args.outcome,
    ...page(args),
  });
}

/**
 * `GET /api/investigations/:id`. The run and everything assembled from it:
 * hypotheses, patches (unified diff included), verification runs, and the
 * counts of its events and evidence.
 */
export async function getInvestigation(ctx: ToolContext, args: { investigationId: string }) {
  return ctx.api.get(`/api/investigations/${encodeURIComponent(args.investigationId)}`);
}

/**
 * `GET /api/investigations/:id/events`. The timeline. `since` is a sequence
 * cursor, and the response carries `nextSince` and `hasMore` to continue with.
 * Debug events are filtered out unless `includeDebug` is set.
 */
export async function listInvestigationEvents(
  ctx: ToolContext,
  args: { investigationId: string; since?: number; limit?: number; includeDebug?: boolean },
) {
  return ctx.api.get(`/api/investigations/${encodeURIComponent(args.investigationId)}/events`, {
    since: args.since,
    limit: args.limit,
    includeDebug: args.includeDebug,
  });
}

/**
 * `GET /api/investigations/:id/evidence`. The observations a conclusion rests
 * on. `total` is the size of the filtered set, so a caller can tell it is
 * holding one page.
 */
export async function listInvestigationEvidence(
  ctx: ToolContext,
  args: PageArgs & { investigationId: string; type?: string },
) {
  return ctx.api.get(`/api/investigations/${encodeURIComponent(args.investigationId)}/evidence`, {
    type: args.type,
    ...page(args),
  });
}

// ── Resolutions ──────────────────────────────────────────────────────────────

/**
 * `GET /api/resolutions`. Assembled records, filterable by `investigation`,
 * `signal` and `confidence`. Each row carries its confidence class together
 * with `notEstablished`, the list of things the run did not establish.
 */
export async function listResolutions(
  ctx: ToolContext,
  args: PageArgs & {
    investigation?: string;
    signal?: string;
    hasSignal?: boolean;
    confidence?: string;
  } = {},
) {
  return ctx.api.get('/api/resolutions', {
    investigation: args.investigation,
    signal: args.signal,
    // Whether the record names a signal at all, rather than which one. Refused
    // alongside `signal` by the engine, which narrows the same column.
    hasSignal: args.hasSignal,
    confidence: args.confidence,
    ...page(args),
  });
}

/**
 * `GET /api/resolutions/latest?investigation=`. The newest record for one
 * investigation, or `{ resolution: null }` when it has produced none yet.
 */
export async function getLatestResolution(ctx: ToolContext, args: { investigationId: string }) {
  return ctx.api.get('/api/resolutions/latest', { investigation: args.investigationId });
}

/**
 * `GET /api/resolutions/:id`. The whole record: what was reported, the
 * reproduction and its signature, the root cause, the fix, the verification
 * verdict, the regression protection before/after, and the confidence class
 * with its gaps. `rootCause`, `fix` and `verification` are null exactly when
 * the run produced no such row -- a null is a hole that is named, never filled.
 */
export async function getResolution(ctx: ToolContext, args: { resolutionId: string }) {
  return ctx.api.get(`/api/resolutions/${encodeURIComponent(args.resolutionId)}`);
}

// ── Validations ──────────────────────────────────────────────────────────────

/** `GET /api/validations`. The validation queue, filterable by repository, state and outcome. */
export async function listValidations(
  ctx: ToolContext,
  args: PageArgs & { repository?: string; state?: string; outcome?: string } = {},
) {
  return ctx.api.get('/api/validations', {
    repository: args.repository,
    state: args.state,
    outcome: args.outcome,
    ...page(args),
  });
}

/**
 * `GET /api/validations/:id`. The run, its environment status (a BLOCKED
 * environment is not a failed change), its change impact, and the counts of
 * checks, findings and evidence.
 */
export async function getValidation(ctx: ToolContext, args: { validationId: string }) {
  return ctx.api.get(`/api/validations/${encodeURIComponent(args.validationId)}`);
}

/**
 * `GET /api/validations/:id/checks`. The plan that was executed, in sequence.
 * `baseStatus` is the load-bearing field: FAILED there means the check was
 * re-run at the base commit and passed, so this change caused it.
 */
export async function listValidationChecks(
  ctx: ToolContext,
  args: PageArgs & { validationId: string; status?: string },
) {
  return ctx.api.get(`/api/validations/${encodeURIComponent(args.validationId)}/checks`, {
    // `total` comes back counted under this filter, so `status: 'FAILED'` with
    // `limit: 1` is how many checks failed rather than how many failed on the
    // page that was fetched.
    status: args.status,
    ...page(args),
  });
}

/**
 * `GET /api/validations/:id/findings`. What was found: severity, confidence,
 * expected vs observed behaviour, reproduction, and the check it came from.
 */
export async function listValidationFindings(
  ctx: ToolContext,
  args: PageArgs & { validationId: string; severity?: string; status?: string },
) {
  return ctx.api.get(`/api/validations/${encodeURIComponent(args.validationId)}/findings`, {
    severity: args.severity,
    status: args.status,
    ...page(args),
  });
}

/**
 * `GET /api/validations/:id/evidence`. The evidence behind a validation's
 * checks, filterable by `type` -- the same filter
 * {@link listInvestigationEvidence} takes over the same rows.
 */
export async function listValidationEvidence(
  ctx: ToolContext,
  args: PageArgs & { validationId: string; type?: string },
) {
  return ctx.api.get(`/api/validations/${encodeURIComponent(args.validationId)}/evidence`, {
    type: args.type,
    ...page(args),
  });
}

/**
 * `GET /api/validations/:id/events`. The validation's timeline, in sequence.
 *
 * The same cursor shape {@link listInvestigationEvents} has over the same
 * event table: `since` in, `nextSince` and `hasMore` back. It is also what a
 * caller polls in place of `/:id/stream`, which this package does not wrap --
 * without it the advice to poll instead of streaming had nothing to poll on
 * the validation side.
 */
export async function listValidationEvents(
  ctx: ToolContext,
  args: { validationId: string; since?: number; limit?: number; includeDebug?: boolean },
) {
  return ctx.api.get(`/api/validations/${encodeURIComponent(args.validationId)}/events`, {
    since: args.since,
    limit: args.limit,
    includeDebug: args.includeDebug,
  });
}

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * `GET /api/health`. Readiness, established by doing the thing it claims:
 * database, migration state and artifact store. Answers 503 when degraded,
 * which arrives here as an error carrying the same body.
 */
export async function getApiHealth(ctx: ToolContext) {
  return ctx.api.get('/api/health');
}
