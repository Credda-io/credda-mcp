/**
 * MCP server wiring: registers Credda's agent-native trust tools on an
 * `McpServer`. Kept separate from `index.ts` (the stdio entrypoint) and
 * `tools.ts` (the pure handlers) so this can be constructed and inspected in
 * tests without a live stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreddaClient } from '@credda/js/headless';
import {
  checkTrust,
  getTrustExportTool,
  verifyTrustCredentialTool,
  verifyVerifiableCredentialTool,
  mintMyTrustToken,
  presentMyCredential,
  checkDeliveryReceipts,
  presentMyDeliveryReceipts,
  getUserScore,
  explainUserScore,
  createScoreMonitor,
  listScoreMonitors,
  deleteScoreMonitor,
  getMyUsage,
  listWebhookEventTypes,
  getDidDocumentResource,
  getTrustRegistryResource,
  type ToolContext,
  issuerDidFor,
} from './tools.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

function asToolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function asToolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export interface CreddaMcpServerOptions {
  apiBase?: string;
  apiKey?: string;
  selfUserId?: string;
}

export function buildServer(options: CreddaMcpServerOptions = {}): McpServer {
  const client = new CreddaClient({ apiBase: options.apiBase });
  const ctx: ToolContext = {
    client,
    apiKey: options.apiKey,
    selfUserId: options.selfUserId,
    apiBase: options.apiBase,
    issuerDid: issuerDidFor(options.apiBase),
  };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'check_trust',
    {
      title: "Check a counterparty's Credda trust",
      description:
        "Look up a counterparty's verifiable, deterministic Credda reliability score by their public " +
        'share token: the token is a capability they hand you (e.g. in a profile URL or a handshake ' +
        'message), no API key needed. Returns the score, band, verified-platform count, and a signed ' +
        'credential you can offline-verify with verify_trust_credential. The score is a pure function ' +
        'of an append-only event ledger, never set or nudged by a human or an AI.',
      inputSchema: { token: z.string().min(1).describe("The counterparty's Credda share token") },
    },
    async ({ token }) => {
      try {
        return asToolResult(await checkTrust(ctx, { token }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'get_trust_export',
    {
      title: "Get a counterparty's portable trust export",
      description:
        'Fetch the full portable, self-verifying trust bundle for a share token: current score, score ' +
        'history, and a signed W3C Verifiable Credential with a revocation pointer. Use this when you ' +
        "need more than the headline score, e.g. to check a counterparty's trend over time before a " +
        'higher-stakes commitment.',
      inputSchema: { token: z.string().min(1).describe("The counterparty's Credda share token") },
    },
    async ({ token }) => {
      try {
        return asToolResult(await getTrustExportTool(ctx, { token }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'verify_trust_credential',
    {
      title: 'Verify a presented Credda credential (offline)',
      description:
        'Offline-verify a signed Credda Verifiable Trust Credential (compact EdDSA JWT format) that a ' +
        "counterparty presented to you directly (e.g. in an agent-to-agent handshake) without a round " +
        "trip to Credda. Checks the signature against Credda's published JWKS, plus issuer and expiry. " +
        'Rejects (throws) on an invalid, expired, or tampered credential.',
      inputSchema: { credential: z.string().min(1).describe('The compact JWT credential string presented to you') },
    },
    async ({ credential }) => {
      try {
        return asToolResult(await verifyTrustCredentialTool(ctx, { credential }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'verify_verifiable_credential',
    {
      title: 'Verify a presented W3C Verifiable Credential (offline)',
      description:
        'Offline-verify a W3C Verifiable Credential (VC-JWT) that a counterparty presented to you, ' +
        "resolving Credda's did:web DID document and checking the revocation status list. Use this for " +
        'credentials in the wider W3C VC ecosystem format rather than verify_trust_credential\'s compact ' +
        'format. Rejects (throws) on an invalid, expired, revoked, or tampered credential.',
      inputSchema: { vcJwt: z.string().min(1).describe('The W3C Verifiable Credential (VC-JWT) presented to you') },
    },
    async ({ vcJwt }) => {
      try {
        return asToolResult(await verifyVerifiableCredentialTool(ctx, { vcJwt }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'mint_my_trust_token',
    {
      title: 'Mint a fresh trust token to present to a counterparty',
      description:
        "Mint a fresh Credda share token for YOUR OWN identity, to hand to a counterparty as your side of " +
        'a trust handshake (they can then call check_trust on it, or you can fetch and hand them ' +
        "get_trust_export / verify_trust_credential's credential directly). Requires this MCP server to " +
        'be configured with CREDDA_API_KEY and CREDDA_USER_ID; it never acts on a counterparty\'s behalf. ' +
        'Minting does not change your score; it only issues a new capability token.',
      inputSchema: {},
    },
    async () => {
      try {
        return asToolResult(await mintMyTrustToken(ctx));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'present_my_credential',
    {
      title: 'Present your Credda trust credential in one call',
      description:
        'Convenience wrapper for the agent-to-agent handshake: mints a fresh share token for YOUR OWN ' +
        'identity and immediately fetches its full portable trust export (score + history + signed W3C ' +
        'credential + revocation pointer) in a single tool call, instead of mint_my_trust_token followed ' +
        'by a separate get_trust_export round trip. Hand the returned token or credential to a ' +
        "counterparty so they can check_trust it or verify it offline. Requires this MCP server to be " +
        'configured with CREDDA_API_KEY and CREDDA_USER_ID. Minting does not change your score.',
      inputSchema: {},
    },
    async () => {
      try {
        return asToolResult(await presentMyCredential(ctx));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'check_delivery_receipts',
    {
      title: "Check a counterparty agent's delivery record",
      description:
        "The evidence view for an agent-to-agent handshake: given the share token a counterparty hands " +
        'you, returns their DELIVERY RECEIPTS: how many deliveries are recorded, how many a DISTINCT ' +
        'counterparty confirmed, how many were their own operator vouching for them (which never counts ' +
        'as confirmed), failures, disputes, and the on-time rate over confirmed deliveries, plus a ' +
        'signed W3C credential of that record you can offline-verify with verify_verifiable_credential. ' +
        'No API key needed. This is a DELIVERY RECORD, not a safety, alignment or capability rating, and ' +
        'never a recommendation: it tells you what was delivered and who confirmed it, and the decision ' +
        'stays yours.',
      inputSchema: { token: z.string().min(1).describe("The counterparty's Credda share token") },
    },
    async ({ token }) => {
      try {
        return asToolResult(await checkDeliveryReceipts(ctx, { token }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'present_my_delivery_receipts',
    {
      title: 'Present your own delivery record to a counterparty',
      description:
        'Your side of the handshake: mints a fresh share token for YOUR OWN Credda-scored identity and ' +
        'fetches its signed delivery credential in one call: the counterparty-confirmed record of what ' +
        'you have actually delivered, which the other side can check offline. Requires this MCP server ' +
        'to be configured with CREDDA_API_KEY and CREDDA_USER_ID; it never acts on a counterparty\'s ' +
        'behalf. Minting issues a capability token; it does not change your score, and nothing you ' +
        'report about yourself is ever counted as confirmed evidence.',
      inputSchema: {},
    },
    async () => {
      try {
        return asToolResult(await presentMyDeliveryReceipts(ctx));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'get_user_score',
    {
      title: "Read one of your platform's users' Credda score",
      description:
        "Read a user's latest computed Credda reliability score by their external id (the id YOUR " +
        'platform reports events under): score, band, confidence, factor breakdown, and the formula ' +
        'version that computed it. Requires CREDDA_API_KEY. Read-only: the score is a pure, ' +
        'deterministic function of the append-only event ledger; no tool (and no AI) can set or ' +
        'nudge it.',
      inputSchema: { userId: z.string().min(1).describe("The user's external id on your platform") },
    },
    async ({ userId }) => {
      try {
        return asToolResult(await getUserScore(ctx, { userId }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'explain_user_score',
    {
      title: "Explain a user's score factor by factor",
      description:
        "The bias-free evidence view of a user's score: a plain-language summary plus the per-factor " +
        'breakdown (completion rate, on-time rate, dispute rate, verification depth), platform trust, ' +
        'consistency, momentum, and confidence level. Requires CREDDA_API_KEY. This explains EVIDENCE ' +
        'only; Credda deliberately has no "evaluate/recommend this person" endpoint; the decision ' +
        'stays with you, made against transparent facts.',
      inputSchema: { userId: z.string().min(1).describe("The user's external id on your platform") },
    },
    async ({ userId }) => {
      try {
        return asToolResult(await explainUserScore(ctx, { userId }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'create_score_monitor',
    {
      title: 'Create a continuous score monitor',
      description:
        "Watch one of your users' scores continuously instead of polling: an edge-triggered monitor " +
        'fires a `monitor.triggered` webhook event when the score crosses DOWN through `belowScore` ' +
        '(also fires if the FIRST computed score is already below it), crosses UP through ' +
        '`aboveScore`, or when `onBandChange` is set and the band label changes. At least one ' +
        'condition is required. Requires CREDDA_API_KEY. A monitor is notification config only; it ' +
        'never affects a score.',
      inputSchema: {
        userId: z.string().min(1).describe("The user's external id on your platform"),
        belowScore: z.number().min(0).max(100).optional()
          .describe('Fire when the score crosses DOWN through this threshold (0–100)'),
        aboveScore: z.number().min(0).max(100).optional()
          .describe('Fire when the score crosses UP through this threshold (0–100)'),
        onBandChange: z.boolean().optional()
          .describe('Fire whenever the score band label changes'),
      },
    },
    async ({ userId, belowScore, aboveScore, onBandChange }) => {
      try {
        return asToolResult(await createScoreMonitor(ctx, { userId, belowScore, aboveScore, onBandChange }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'list_score_monitors',
    {
      title: "List your platform's score monitors",
      description:
        "List your platform's continuous score monitors (cursor-paginated): each monitor's user, " +
        'thresholds, band-change flag, active state, and when it last triggered. Requires ' +
        'CREDDA_API_KEY.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 50, max 100)'),
        cursor: z.string().optional().describe('Cursor from a previous page (`nextCursor`)'),
      },
    },
    async ({ limit, cursor }) => {
      try {
        return asToolResult(await listScoreMonitors(ctx, { limit, cursor }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'delete_score_monitor',
    {
      title: 'Delete a score monitor',
      description:
        'Delete one of your continuous score monitors by id (hard delete; a monitor is notification ' +
        'config, not ledger data, so nothing score-related is touched). Requires CREDDA_API_KEY.',
      inputSchema: { id: z.string().min(1).describe('The monitor id (from list_score_monitors)') },
    },
    async ({ id }) => {
      try {
        return asToolResult(await deleteScoreMonitor(ctx, { id }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'get_my_usage',
    {
      title: "Read your own API key's usage and quota",
      description:
        "Observability for the agent's own key: your platform's API usage per day (by status class), " +
        'tier rate limit, monthly quota consumption, and busiest endpoints over the window. Requires ' +
        'CREDDA_API_KEY. Advisory observability only; usage never affects any score.',
      inputSchema: {
        days: z.number().int().min(1).max(400).optional()
          .describe('Trailing window in days (default 7, max 400; days beyond Redis retention are served from durable daily rollups)'),
      },
    },
    async ({ days }) => {
      try {
        return asToolResult(await getMyUsage(ctx, { days }));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerTool(
    'list_webhook_event_types',
    {
      title: 'List the webhook event types Credda can send',
      description:
        'The public outbound webhook event catalog: every event type the API can deliver (e.g. ' +
        '`score.updated`, `score.band_changed`, `monitor.triggered`), with a description and example ' +
        'payload per event, the common delivery envelope, and how to verify a delivery signature. No ' +
        'API key needed. Use it to discover what create_score_monitor and webhook subscriptions can ' +
        'notify you about. Webhooks are advisory: no event can change anyone\'s score.',
      inputSchema: {},
    },
    async () => {
      try {
        return asToolResult(await listWebhookEventTypes(ctx));
      } catch (err) {
        return asToolError(err);
      }
    },
  );

  server.registerResource(
    'trust_registry',
    'credda-trust://registry',
    {
      title: 'Credda trust registry',
      description:
        "The trust registry: Credda's own issuer entry (DID, JWKS, credential types) plus any " +
        'federated issuers it recognizes (Trust Fabric v3 federation). Read this before ' +
        "verify_verifiable_credential if you need to confirm an issuer is one Credda's network " +
        'recognizes, not just that a signature checks out.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await getTrustRegistryResource(ctx), null, 2) },
      ],
    }),
  );

  server.registerResource(
    'issuer_did_document',
    'credda-trust://did',
    {
      title: "Credda's did:web DID document",
      description:
        "Credda's did:web DID document: issuer identity, EdDSA verification keys, and service " +
        'endpoints (incl. the trust registry). The same document verify_verifiable_credential ' +
        'resolves internally; exposed here so an agent can inspect it directly for discovery.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await getDidDocumentResource(ctx), null, 2) },
      ],
    }),
  );

  return server;
}
