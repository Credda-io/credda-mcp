/**
 * Pure tool handlers: no MCP SDK types here, so they're testable with a
 * plain mocked `CreddaClient`. `src/server.ts` wires these into MCP tool
 * registrations (schemas, titles, descriptions).
 *
 * No tool here writes an Event, adjusts a score, or makes a trust decision.
 * Most let an agent look up and offline-verify EXISTING, already-computed trust
 * facts. The "mint" tool issues a new share token (a capability, not a score
 * write). `requestConfirmation` is the one tool that creates something: a
 * PENDING ask, which is still not a ledger write.
 *
 * WHY THE ASK IS SAFE, and why it is safer than the `POST /events` path this
 * server deliberately does not expose. Creating a confirmation request stores a
 * proposal and hands back a one-time link. The verified event is written by
 * `POST /api/v1/confirmations/:id/respond`, which takes NO API key because the
 * named counterparty holds a token instead of an account. So an agent holding
 * its platform's key can ASK, and cannot ANSWER. `POST /events`, by contrast,
 * lets a caller assert `isVerified: true` about itself; that is exactly why it
 * is absent here and why this is not. See `src/writeSurface.test.ts`, which
 * fails if a later edit adds a way to answer.
 *
 * The platform also keeps delivery. Credda sends no email for this flow and
 * never learns the counterparty's address; the caller sends the link over its
 * own channel.
 */

import {
  verifyVerifiableCredential,
  type CreddaClient,
  type ConfirmationStatus,
  type ConfirmerType,
  type IngestEventType,
} from '@credda/js/headless';

export interface ToolContext {
  client: CreddaClient;
  /** Present only if the server was configured with a platform API key. */
  apiKey?: string;
  /** The userId the configured API key should mint/manage tokens for. */
  selfUserId?: string;
  /** The API base this server talks to, so a verifier can fall back to its JWKS. */
  apiBase?: string;
  /**
   * The issuer every credential verification must match, derived from the API
   * base this server talks to.
   *
   * ⚠️ WITHOUT THIS, `verify_verifiable_credential` IS AN AGENT-FACING FORGERY
   * ORACLE. did:web resolution proves a credential was signed by whoever
   * controls the DID's host; it does not prove that host is Credda. An agent
   * handed a credential minted under anyone's domain would be told it is valid,
   * and agents act on that answer without a human reading it.
   */
  issuerDid: string;
}

/** The did:web identity of an API origin: `https://api.credda.io` -> `did:web:api.credda.io`. */
export function issuerDidFor(apiBase: string | undefined): string {
  const base = (apiBase ?? 'https://api.credda.io').replace(/\/+$/, '');
  try {
    return `did:web:${new URL(base).host.toLowerCase()}`;
  } catch {
    return 'did:web:api.credda.io';
  }
}

function notConfigured(): never {
  throw new Error(
    'This tool requires CREDDA_API_KEY and CREDDA_USER_ID to be set in the MCP server config; ' +
      'it acts on behalf of YOUR OWN Credda-scored identity, not a counterparty\'s. ' +
      'check_trust / get_trust_export / verify_* work without any configuration.',
  );
}

function keyNotConfigured(): never {
  throw new Error(
    'This tool requires CREDDA_API_KEY to be set in the MCP server config; it reads score data ' +
      "and manages monitors under YOUR platform's API key. The public tools (check_trust / " +
      'get_trust_export / verify_* / list_webhook_event_types) work without any configuration.',
  );
}

export async function checkTrust(ctx: ToolContext, args: { token: string }) {
  const payload = await ctx.client.resolveToken(args.token);
  return {
    token: payload.token,
    finalScore: payload.finalScore,
    scoreBand: payload.scoreBand,
    confidence: payload.confidence,
    verifiedPlatforms: payload.verifiedPlatforms,
    totalEvents: payload.totalEvents,
    scoreFrozen: payload.scoreFrozen,
    formulaVersion: payload.formulaVersion,
    computedAt: payload.computedAt,
    issuer: payload.issuer,
    /** Signed Verifiable Trust Credential. Pass to `verify_trust_credential` to check it offline. */
    credential: payload.credential,
  };
}

export async function getTrustExportTool(ctx: ToolContext, args: { token: string }) {
  return ctx.client.getTrustExport(args.token);
}

export async function verifyTrustCredentialTool(ctx: ToolContext, args: { credential: string }) {
  return ctx.client.verifyCredential(args.credential);
}

export async function verifyVerifiableCredentialTool(ctx: ToolContext, args: { vcJwt: string }) {
  // The SDK's client wrapper takes no options, and the pinned SDK line has no
  // issuer default, so the expectation is stated here where the untrusted input
  // arrives. See ToolContext.issuerDid.
  return verifyVerifiableCredential(args.vcJwt, {
    apiBase: ctx.apiBase,
    issuer: ctx.issuerDid,
  });
}

export async function mintMyTrustToken(ctx: ToolContext) {
  if (!ctx.apiKey || !ctx.selfUserId) notConfigured();
  return ctx.client.mintShareToken(ctx.selfUserId, ctx.apiKey);
}

export async function presentMyCredential(ctx: ToolContext) {
  if (!ctx.apiKey || !ctx.selfUserId) notConfigured();
  const minted = await ctx.client.mintShareToken(ctx.selfUserId, ctx.apiKey);
  const bundle = await ctx.client.getTrustExport(minted.token);
  return {
    token: minted.token,
    verifyUrl: minted.verifyUrl,
    /** The full self-verifying export: score + history + signed W3C credential + revocation pointer. */
    export: bundle,
  };
}

// ── Agent delivery receipts (the agent-to-agent handshake) ───────────────────
//
// The two sides of the same exchange: present YOUR delivery record, and check
// theirs. Both return EVIDENCE: counts of what was delivered and how much of it
// an independent counterparty confirmed. Neither returns a verdict, a rating, or
// a recommendation, and there is deliberately no tool that does.

/**
 * Check a counterparty's delivery record from the share token they handed you.
 * Public, no key needed.
 */
export async function checkDeliveryReceipts(ctx: ToolContext, args: { token: string }) {
  const r = await ctx.client.getDeliveryReceipts(args.token);
  return {
    token: r.token,
    subjectType: r.subjectType,
    agent: r.agent,
    deliveryRecord: r.deliveryRecord,
    score: r.score,
    disclaimer: r.disclaimer,
    /** Signed W3C credential of the record. Offline-check it with verify_verifiable_credential. */
    credentialVc: r.credentialVc,
    issuer: r.issuer,
    expiresAt: r.expiresAt,
  };
}

/**
 * Present YOUR OWN delivery record mid-negotiation: mints a fresh share token
 * for the configured subject and fetches its signed delivery credential in one
 * call, so a counterparty can verify it offline. Minting issues a capability.
 * It does not change a score.
 */
export async function presentMyDeliveryReceipts(ctx: ToolContext) {
  if (!ctx.apiKey || !ctx.selfUserId) notConfigured();
  const minted = await ctx.client.mintShareToken(ctx.selfUserId, ctx.apiKey);
  const receipts = await ctx.client.getDeliveryReceipts(minted.token);
  return {
    token: minted.token,
    verifyUrl: minted.verifyUrl,
    /** Hand this whole object (or just the token) to your counterparty. */
    receipts,
  };
}

// ── Platform reads + continuous monitoring (CREDDA_API_KEY only) ──────────────
// These act under the platform's OWN key: read a user's deterministic score /
// its evidence breakdown, watch it with edge-triggered monitors (notification
// config: a monitor never affects a score), and read the key's own usage.
// None of them can write an Event or a ScoreSnapshot, and there is deliberately
// no "evaluate this person" tool: Credda explains evidence, it never issues a
// verdict.

export async function getUserScore(ctx: ToolContext, args: { userId: string }) {
  if (!ctx.apiKey) keyNotConfigured();
  const s = await ctx.client.getScore(args.userId, ctx.apiKey);
  return {
    userId: s.userId,
    finalScore: s.finalScore,
    scoreBand: s.scoreBand,
    confidence: s.confidence,
    formulaVersion: s.formulaVersion,
    velocityFlag: s.velocityFlag,
    scoreFrozen: s.scoreFrozen ?? false,
    computedAt: s.computedAt,
    breakdown: s.breakdown,
  };
}

export async function explainUserScore(ctx: ToolContext, args: { userId: string }) {
  if (!ctx.apiKey) keyNotConfigured();
  return ctx.client.getScoreExplain(args.userId, ctx.apiKey);
}

export async function createScoreMonitor(
  ctx: ToolContext,
  args: { userId: string; belowScore?: number; aboveScore?: number; onBandChange?: boolean },
) {
  if (!ctx.apiKey) keyNotConfigured();
  const { monitor } = await ctx.client.createMonitor(
    {
      userId: args.userId,
      belowScore: args.belowScore,
      aboveScore: args.aboveScore,
      onBandChange: args.onBandChange,
    },
    ctx.apiKey,
  );
  return monitor;
}

export async function listScoreMonitors(
  ctx: ToolContext,
  args: { limit?: number; cursor?: string } = {},
) {
  if (!ctx.apiKey) keyNotConfigured();
  return ctx.client.listMonitors(ctx.apiKey, { limit: args.limit, cursor: args.cursor });
}

export async function deleteScoreMonitor(ctx: ToolContext, args: { id: string }) {
  if (!ctx.apiKey) keyNotConfigured();
  await ctx.client.deleteMonitor(args.id, ctx.apiKey);
  return { deleted: true, id: args.id };
}

export async function getMyUsage(ctx: ToolContext, args: { days?: number } = {}) {
  if (!ctx.apiKey) keyNotConfigured();
  return ctx.client.getUsage(ctx.apiKey, args.days);
}

/**
 * Public (no key): the outbound webhook event catalog, what a platform can
 * subscribe to (incl. `monitor.triggered`, which the monitor tools above feed).
 */
export async function listWebhookEventTypes(ctx: ToolContext) {
  return ctx.client.getWebhookEvents();
}

/**
 * Discovery docs (public, no key) for the two MCP resources below: a
 * counterparty-verification agent's "who signs Credda's credentials, and who
 * else is federated into this trust network" lookup, without a tool call.
 */
export async function getDidDocumentResource(ctx: ToolContext) {
  return ctx.client.getDidDocument();
}

export async function getTrustRegistryResource(ctx: ToolContext) {
  return ctx.client.getTrustRegistry();
}

// ── Requesting a confirmation (CREDDA_API_KEY) ────────────────────────────────
//
// Everything above this line consumes trust that already exists. This is the
// one place an agent can SUPPLY it: propose an outcome and ask the named
// counterparty to confirm it. Confirmations are free at every tier by explicit
// decision (the API's confirmation routes carry no scope gate and every plan
// lists `confirmations` as a read feature), so a read-only Starter key can do
// this. Nothing here is metered beyond the ordinary request quota, and no plan
// changes what a confirmation is worth.

/**
 * The event types a confirmation request may propose. The same set
 * `POST /api/v1/events` accepts, positive and negative alike, because a
 * counterparty can confirm a job well done or a contract breached with equal
 * validity.
 */
export const CONFIRMABLE_EVENT_TYPES = [
  'TRANSACTION_COMPLETED',
  'CONTRACT_FULFILLED',
  'REVIEW_VERIFIED',
  'DISPUTE_RESOLVED_FOR_USER',
  'TRANSACTION_CANCELLED',
  'CONTRACT_CANCELLED',
  'CONTRACT_BREACHED',
  'TRANSACTION_DISPUTED',
] as const satisfies readonly IngestEventType[];

/**
 * Compile-time drift guard in the other direction: `satisfies` above catches a
 * value this list should not contain, and this catches an `IngestEventType` the
 * list is missing. A new event type in the pinned SDK therefore fails `tsc`
 * here rather than silently becoming unaskable through the MCP server.
 */
type _EveryIngestTypeIsConfirmable =
  Exclude<IngestEventType, (typeof CONFIRMABLE_EVENT_TYPES)[number]> extends never ? true : never;
const _everyIngestTypeIsConfirmable: _EveryIngestTypeIsConfirmable = true;
void _everyIngestTypeIsConfirmable;

export interface RequestConfirmationArgs {
  /** Subject of the proposed outcome. Defaults to the configured CREDDA_USER_ID. */
  userId?: string;
  eventType: (typeof CONFIRMABLE_EVENT_TYPES)[number];
  /** Your own key for the party being ASKED. Must not name the subject. */
  counterpartyRef: string;
  counterpartyName?: string;
  description?: string;
  stakeLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  transactionValue?: number;
  dueDate?: string;
  completedAt?: string;
  confirmerType?: ConfirmerType;
  expiresInDays?: number;
  idempotencyKey?: string;
}

/**
 * Propose an outcome and get back a one-time link to send to the counterparty.
 * `POST /api/v1/confirmations`.
 *
 * Writes NO event and moves NO score. The returned request is PENDING and its
 * `resultingEventId` is null; a verified event exists only once the named
 * counterparty opens the link and affirmatively confirms. The caller cannot do
 * that on their behalf and neither can this server.
 *
 * Of the four delivery handles the API returns, only the hosted page comes back
 * here. The bare one-time token and the endpoint a decision is posted to are
 * dropped: the operator needs a link to forward, not a recipe for answering.
 */
export async function requestConfirmation(ctx: ToolContext, args: RequestConfirmationArgs) {
  if (!ctx.apiKey) keyNotConfigured();
  const userId = args.userId ?? ctx.selfUserId;
  if (!userId) {
    throw new Error(
      'request_confirmation needs `userId`, your own external id for the SUBJECT of the ' +
        'proposed outcome. Or set CREDDA_USER_ID in the MCP server config to name that subject.',
    );
  }

  const created = await ctx.client.createConfirmationRequest(
    {
      userId,
      eventType: args.eventType,
      // Passed through untouched. The server rejects a request whose
      // counterparty names the subject (400 CONFIRMATION_SELF); that check must
      // stay the server's, so nothing here normalizes or rewrites it.
      counterpartyRef: args.counterpartyRef,
      ...(args.counterpartyName ? { counterpartyName: args.counterpartyName } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.stakeLevel ? { stakeLevel: args.stakeLevel } : {}),
      ...(args.transactionValue !== undefined ? { transactionValue: args.transactionValue } : {}),
      ...(args.dueDate ? { dueDate: args.dueDate } : {}),
      ...(args.completedAt ? { completedAt: args.completedAt } : {}),
      ...(args.confirmerType ? { confirmerType: args.confirmerType } : {}),
      ...(args.expiresInDays !== undefined ? { expiresInDays: args.expiresInDays } : {}),
    },
    ctx.apiKey,
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
  );

  const c = created.confirmation;
  return {
    id: c.id,
    status: c.status,
    subjectExternalId: c.subjectExternalId,
    eventType: c.eventType,
    counterpartyRef: c.counterpartyRef,
    counterpartyName: c.counterpartyName,
    description: c.description,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
    /** Null until the counterparty confirms. It is the only proof anything was recorded. */
    resultingEventId: c.resultingEventId,
    /** Send this to the counterparty. It is single-use and expires. */
    confirmUrl: created.confirmUrl,
    delivery:
      'You deliver this link over your own channel. Credda sends no email for this flow and ' +
      'never learns the counterparty\'s address.',
    ledger:
      'Nothing has been recorded. This request wrote no event and moved no score. The verified ' +
      'event exists only if the named counterparty opens the link and confirms; you cannot ' +
      'confirm it for them, and neither can this server.',
  };
}

/**
 * List the confirmation requests your key has created, newest first,
 * cursor-paginated. `GET /api/v1/confirmations`. Filter with
 * `status: 'PENDING'` for the outstanding ones, the asks still waiting on a
 * counterparty. Read-only.
 */
export async function listConfirmationRequests(
  ctx: ToolContext,
  args: { status?: ConfirmationStatus; limit?: number; cursor?: string } = {},
) {
  if (!ctx.apiKey) keyNotConfigured();
  return ctx.client.listConfirmations(ctx.apiKey, {
    ...(args.status ? { status: args.status } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.cursor ? { cursor: args.cursor } : {}),
  });
}
