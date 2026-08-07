/**
 * Pure tool handlers — no MCP SDK types here, so they're testable with a
 * plain mocked `CreddaClient`. `src/server.ts` wires these into MCP tool
 * registrations (schemas, titles, descriptions).
 *
 * Every tool is READ-ONLY against Credda's deterministic score. None of them
 * write an Event, adjust a score, or make a trust decision — they let an
 * agent look up and offline-verify EXISTING, already-computed trust facts.
 * The "mint" tool issues a new share token (a capability, not a score write).
 */

import type { CreddaClient } from '@credda/js/headless';

export interface ToolContext {
  client: CreddaClient;
  /** Present only if the server was configured with a platform API key. */
  apiKey?: string;
  /** The userId the configured API key should mint/manage tokens for. */
  selfUserId?: string;
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
    /** Signed Verifiable Trust Credential — pass to `verify_trust_credential` to check it offline. */
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
  return ctx.client.verifyVerifiableCredential(args.vcJwt);
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
// theirs. Both return EVIDENCE — counts of what was delivered and how much of it
// an independent counterparty confirmed. Neither returns a verdict, a rating, or
// a recommendation, and there is deliberately no tool that does.

/**
 * Check a counterparty's delivery record from the share token they handed you.
 * Public — no key needed.
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
    /** Signed W3C credential of the record — offline-check it with verify_verifiable_credential. */
    credentialVc: r.credentialVc,
    issuer: r.issuer,
    expiresAt: r.expiresAt,
  };
}

/**
 * Present YOUR OWN delivery record mid-negotiation: mints a fresh share token
 * for the configured subject and fetches its signed delivery credential in one
 * call, so a counterparty can verify it offline. Minting issues a capability —
 * it does not change a score.
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
// config — a monitor never affects a score), and read the key's own usage.
// None of them can write an Event or a ScoreSnapshot, and there is deliberately
// no "evaluate this person" tool — Credda explains evidence, it never issues a
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
 * Public (no key): the outbound webhook event catalog — what a platform can
 * subscribe to (incl. `monitor.triggered`, which the monitor tools above feed).
 */
export async function listWebhookEventTypes(ctx: ToolContext) {
  return ctx.client.getWebhookEvents();
}

/**
 * Discovery docs (public, no key) for the two MCP resources below — a
 * counterparty-verification agent's "who signs Credda's credentials, and who
 * else is federated into this trust network" lookup, without a tool call.
 */
export async function getDidDocumentResource(ctx: ToolContext) {
  return ctx.client.getDidDocument();
}

export async function getTrustRegistryResource(ctx: ToolContext) {
  return ctx.client.getTrustRegistry();
}
