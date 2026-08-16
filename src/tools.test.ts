import { describe, it, expect, vi } from 'vitest';
import {
  checkTrust,
  getTrustExportTool,
  verifyTrustCredentialTool,
  verifyVerifiableCredentialTool,
  mintMyTrustToken,
  presentMyCredential,
  checkDeliveryReceipts,
  presentMyDeliveryReceipts,
  issuerDidFor,
  getUserScore,
  explainUserScore,
  createScoreMonitor,
  listScoreMonitors,
  deleteScoreMonitor,
  getMyUsage,
  listWebhookEventTypes,
  getDidDocumentResource,
  getTrustRegistryResource,
  requestConfirmation,
  listConfirmationRequests,
  type ToolContext,
} from './tools.js';

/** The issuer these fixtures pretend to be. */
const TEST_ISSUER = 'did:web:api.credda.io';

vi.mock('@credda/js/headless', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, verifyVerifiableCredential: vi.fn() };
});
const verifySpy = vi.mocked((await import('@credda/js/headless')).verifyVerifiableCredential);

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    resolveToken: vi.fn(),
    getTrustExport: vi.fn(),
    verifyCredential: vi.fn(),
    verifyVerifiableCredential: vi.fn(),
    mintShareToken: vi.fn(),
    getDidDocument: vi.fn(),
    getTrustRegistry: vi.fn(),
    getScore: vi.fn(),
    getScoreExplain: vi.fn(),
    createMonitor: vi.fn(),
    listMonitors: vi.fn(),
    deleteMonitor: vi.fn(),
    getUsage: vi.fn(),
    getWebhookEvents: vi.fn(),
    getDeliveryReceipts: vi.fn(),
    createConfirmationRequest: vi.fn(),
    listConfirmations: vi.fn(),
    ...overrides,
  } as unknown as ToolContext['client'];
}

describe('checkTrust', () => {
  it('resolves the token and shapes a compact payload with the credential', async () => {
    const client = fakeClient({
      resolveToken: vi.fn(async (token: string) => ({
        token,
        finalScore: 82,
        scoreBand: 'Excellent',
        confidence: 1,
        verifiedPlatforms: 3,
        totalEvents: 40,
        scoreFrozen: false,
        formulaVersion: '3.0',
        computedAt: '2026-07-19T00:00:00.000Z',
        issuer: 'credda.io',
        credential: 'eyJ.compact.jwt',
        credentialKid: 'k1',
        credentialExp: '2026-07-19T01:00:00.000Z',
        jwksUri: '/.well-known/jwks.json',
      })),
    });
    const result = await checkTrust({ client, issuerDid: TEST_ISSUER }, { token: 'crd_share_abc' });
    expect(client.resolveToken).toHaveBeenCalledWith('crd_share_abc');
    expect(result.finalScore).toBe(82);
    expect(result.scoreBand).toBe('Excellent');
    expect(result.credential).toBe('eyJ.compact.jwt');
  });
});

describe('getTrustExportTool', () => {
  it('passes through the client export bundle', async () => {
    const bundle = { format: 'credda-trust-export/1' };
    const client = fakeClient({ getTrustExport: vi.fn(async () => bundle) });
    const result = await getTrustExportTool({ client, issuerDid: TEST_ISSUER }, { token: 'crd_share_abc' });
    expect(client.getTrustExport).toHaveBeenCalledWith('crd_share_abc');
    expect(result).toBe(bundle);
  });
});

describe('verifyTrustCredentialTool', () => {
  it('delegates to client.verifyCredential', async () => {
    const verified = { valid: true, issuer: 'credda.io', subject: 'crd_share_abc' };
    const client = fakeClient({ verifyCredential: vi.fn(async () => verified) });
    const result = await verifyTrustCredentialTool({ client, issuerDid: TEST_ISSUER }, { credential: 'eyJ.jwt' });
    expect(client.verifyCredential).toHaveBeenCalledWith('eyJ.jwt');
    expect(result).toBe(verified);
  });

  it('propagates rejection for an invalid credential', async () => {
    const client = fakeClient({
      verifyCredential: vi.fn(async () => { throw new Error('credda: signature invalid'); }),
    });
    await expect(verifyTrustCredentialTool({ client, issuerDid: TEST_ISSUER }, { credential: 'bad' })).rejects.toThrow(
      'credda: signature invalid',
    );
  });
});

describe('verifyVerifiableCredentialTool', () => {
  // It calls the SDK verifier DIRECTLY rather than the client wrapper, because
  // the wrapper takes no options and the expected issuer is the whole point:
  // did:web proves who signed a credential, never that the signer is Credda, so
  // an agent handed a credential minted under anyone's domain would otherwise be
  // told it is valid.
  it('tells the verifier which issuer it expects, and passes the base for JWKS fallback', async () => {
    const verified = { valid: true, issuer: 'did:web:api.credda.io', subject: 'crd_share_abc' };
    verifySpy.mockResolvedValueOnce(verified as never);

    const result = await verifyVerifiableCredentialTool(
      { client: fakeClient(), apiBase: 'https://staging-api.credda.io', issuerDid: 'did:web:staging-api.credda.io' },
      { vcJwt: 'eyJ.vc.jwt' },
    );

    expect(verifySpy).toHaveBeenCalledWith('eyJ.vc.jwt', {
      apiBase: 'https://staging-api.credda.io',
      issuer: 'did:web:staging-api.credda.io',
    });
    expect(result).toBe(verified);
  });

  it('expects the issuer of the base the server was configured with', () => {
    expect(issuerDidFor(undefined)).toBe('did:web:api.credda.io');
    expect(issuerDidFor('https://staging-api.credda.io')).toBe('did:web:staging-api.credda.io');
    expect(issuerDidFor('https://api.credda.io/')).toBe('did:web:api.credda.io');
    // A base nobody can parse must not silently become "trust anyone".
    expect(issuerDidFor('not-a-url')).toBe('did:web:api.credda.io');
  });
});

describe('mintMyTrustToken', () => {
  it('mints a token using the configured self identity', async () => {
    const minted = { token: 'crd_share_new', verifyUrl: 'https://api.credda.io/v/crd_share_new', embedSnippet: '', widgetSrc: '' };
    const client = fakeClient({ mintShareToken: vi.fn(async () => minted) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', selfUserId: 'user_1', issuerDid: TEST_ISSUER };
    const result = await mintMyTrustToken(ctx);
    expect(client.mintShareToken).toHaveBeenCalledWith('user_1', 'crd_live_xyz');
    expect(result).toBe(minted);
  });

  it('rejects with a clear config error when apiKey/selfUserId are missing', async () => {
    const client = fakeClient();
    await expect(mintMyTrustToken({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.mintShareToken).not.toHaveBeenCalled();
  });
});

describe('presentMyCredential', () => {
  it('mints a token then fetches its export bundle in one call', async () => {
    const minted = { token: 'crd_share_new', verifyUrl: 'https://api.credda.io/v/crd_share_new', embedSnippet: '', widgetSrc: '' };
    const bundle = { format: 'credda-trust-export/1', credential: 'eyJ.vc.jwt' };
    const client = fakeClient({
      mintShareToken: vi.fn(async () => minted),
      getTrustExport: vi.fn(async () => bundle),
    });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', selfUserId: 'user_1', issuerDid: TEST_ISSUER };
    const result = await presentMyCredential(ctx);
    expect(client.mintShareToken).toHaveBeenCalledWith('user_1', 'crd_live_xyz');
    expect(client.getTrustExport).toHaveBeenCalledWith('crd_share_new');
    expect(result).toEqual({ token: 'crd_share_new', verifyUrl: minted.verifyUrl, export: bundle });
  });

  it('rejects with a clear config error when apiKey/selfUserId are missing', async () => {
    const client = fakeClient();
    await expect(presentMyCredential({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.mintShareToken).not.toHaveBeenCalled();
    expect(client.getTrustExport).not.toHaveBeenCalled();
  });
});

describe('getUserScore', () => {
  it('reads the score with the configured key and shapes a compact payload', async () => {
    const client = fakeClient({
      getScore: vi.fn(async () => ({
        userId: 'ext_1',
        finalScore: 71,
        scoreBand: 'Good',
        confidence: 0.9,
        breakdown: { completionRate: 0.95 },
        formulaVersion: '5.3',
        velocityFlag: false,
        computedAt: '2026-07-22T00:00:00.000Z',
      })),
    });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await getUserScore(ctx, { userId: 'ext_1' });
    expect(client.getScore).toHaveBeenCalledWith('ext_1', 'crd_live_xyz');
    expect(result.finalScore).toBe(71);
    expect(result.scoreBand).toBe('Good');
    expect(result.formulaVersion).toBe('5.3');
    expect(result.scoreFrozen).toBe(false);
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(getUserScore({ client, issuerDid: TEST_ISSUER }, { userId: 'ext_1' })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.getScore).not.toHaveBeenCalled();
  });
});

describe('explainUserScore', () => {
  it('delegates to client.getScoreExplain with the configured key', async () => {
    const explain = { summary: 'Reliable', factors: [], confidence: { level: 'high' } };
    const client = fakeClient({ getScoreExplain: vi.fn(async () => explain) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await explainUserScore(ctx, { userId: 'ext_1' });
    expect(client.getScoreExplain).toHaveBeenCalledWith('ext_1', 'crd_live_xyz');
    expect(result).toBe(explain);
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(explainUserScore({ client, issuerDid: TEST_ISSUER }, { userId: 'ext_1' })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.getScoreExplain).not.toHaveBeenCalled();
  });
});

describe('createScoreMonitor', () => {
  it('creates a monitor and unwraps the result', async () => {
    const monitor = {
      id: 'mon_1', userId: 'ext_1', belowScore: 40, aboveScore: null, onBandChange: true,
      isActive: true, lastTriggeredAt: null, createdAt: 'now', updatedAt: 'now',
    };
    const client = fakeClient({ createMonitor: vi.fn(async () => ({ monitor })) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await createScoreMonitor(ctx, { userId: 'ext_1', belowScore: 40, onBandChange: true });
    expect(client.createMonitor).toHaveBeenCalledWith(
      { userId: 'ext_1', belowScore: 40, aboveScore: undefined, onBandChange: true },
      'crd_live_xyz',
    );
    expect(result).toBe(monitor);
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(createScoreMonitor({ client, issuerDid: TEST_ISSUER }, { userId: 'ext_1', belowScore: 40 })).rejects.toThrow(
      /CREDDA_API_KEY/,
    );
    expect(client.createMonitor).not.toHaveBeenCalled();
  });
});

describe('listScoreMonitors', () => {
  it('lists monitors, passing pagination through', async () => {
    const page = { data: [{ id: 'mon_1' }], nextCursor: null };
    const client = fakeClient({ listMonitors: vi.fn(async () => page) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await listScoreMonitors(ctx, { limit: 10, cursor: 'c1' });
    expect(client.listMonitors).toHaveBeenCalledWith('crd_live_xyz', { limit: 10, cursor: 'c1' });
    expect(result).toBe(page);
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(listScoreMonitors({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.listMonitors).not.toHaveBeenCalled();
  });
});

describe('deleteScoreMonitor', () => {
  it('deletes the monitor and confirms', async () => {
    const client = fakeClient({ deleteMonitor: vi.fn(async () => undefined) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await deleteScoreMonitor(ctx, { id: 'mon_1' });
    expect(client.deleteMonitor).toHaveBeenCalledWith('mon_1', 'crd_live_xyz');
    expect(result).toEqual({ deleted: true, id: 'mon_1' });
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(deleteScoreMonitor({ client, issuerDid: TEST_ISSUER }, { id: 'mon_1' })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.deleteMonitor).not.toHaveBeenCalled();
  });
});

describe('getMyUsage', () => {
  it('reads usage for the configured key with an optional window', async () => {
    const usage = { platform: { id: 'p1', name: 'Acme', tier: 'GROWTH' }, days: [] };
    const client = fakeClient({ getUsage: vi.fn(async () => usage) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await getMyUsage(ctx, { days: 30 });
    expect(client.getUsage).toHaveBeenCalledWith('crd_live_xyz', 30);
    expect(result).toBe(usage);
  });

  it('rejects with a clear config error when the key is missing', async () => {
    const client = fakeClient();
    await expect(getMyUsage({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.getUsage).not.toHaveBeenCalled();
  });
});

describe('listWebhookEventTypes', () => {
  it('is public: delegates to client.getWebhookEvents without any key', async () => {
    const catalog = { events: [{ type: 'monitor.triggered' }], envelope: {} };
    const client = fakeClient({ getWebhookEvents: vi.fn(async () => catalog) });
    const result = await listWebhookEventTypes({ client, issuerDid: TEST_ISSUER });
    expect(client.getWebhookEvents).toHaveBeenCalled();
    expect(result).toBe(catalog);
  });
});

describe('getDidDocumentResource', () => {
  it('delegates to client.getDidDocument', async () => {
    const doc = { id: 'did:web:api.credda.io', service: [] };
    const client = fakeClient({ getDidDocument: vi.fn(async () => doc) });
    const result = await getDidDocumentResource({ client, issuerDid: TEST_ISSUER });
    expect(client.getDidDocument).toHaveBeenCalled();
    expect(result).toBe(doc);
  });
});

describe('getTrustRegistryResource', () => {
  it('delegates to client.getTrustRegistry', async () => {
    const registry = { version: '1', issuers: [{ did: 'did:web:api.credda.io' }] };
    const client = fakeClient({ getTrustRegistry: vi.fn(async () => registry) });
    const result = await getTrustRegistryResource({ client, issuerDid: TEST_ISSUER });
    expect(client.getTrustRegistry).toHaveBeenCalled();
    expect(result).toBe(registry);
  });
});

// ── Agent delivery receipts ──────────────────────────────────────────────────

const RECEIPTS = {
  token: 'crd_share_abc',
  subjectType: 'agent' as const,
  agent: { operatorName: 'Acme AI', operatorIsRegisteredPlatform: true },
  deliveryRecord: {
    deliveries: 12,
    confirmedDeliveries: 9,
    unconfirmedDeliveries: 3,
    selfAttestedDeliveries: 3,
    failures: 1,
    disputes: 0,
    onTimeConfirmedDeliveries: 8,
    onTimeRate: 8 / 9,
    firstRecordedAt: '2026-01-01T00:00:00.000Z',
    lastRecordedAt: '2026-07-01T00:00:00.000Z',
  },
  score: { finalScore: 61, scoreBand: 'Good', confidence: 0.8, formulaVersion: '5.3', computedAt: null, scoreFrozen: false },
  disclaimer: { isA: 'record', isNot: ['not a rating'], selfDealingRule: 'operator cannot confirm' },
  credentialVc: 'eyJ.vc.jwt',
  issuer: 'did:web:api.credda.io',
  expiresAt: '2026-07-22T01:00:00.000Z',
  kid: 'did:web:api.credda.io#k1',
};

describe('checkDeliveryReceipts', () => {
  it('is public: needs no API key and returns the evidence, not a verdict', async () => {
    const client = fakeClient({ getDeliveryReceipts: vi.fn(async () => RECEIPTS) });
    const result = await checkDeliveryReceipts({ client, issuerDid: TEST_ISSUER }, { token: 'crd_share_abc' });
    expect(client.getDeliveryReceipts).toHaveBeenCalledWith('crd_share_abc');
    expect(result.deliveryRecord.confirmedDeliveries).toBe(9);
    expect(result.deliveryRecord.selfAttestedDeliveries).toBe(3);
    expect(result.credentialVc).toBe('eyJ.vc.jwt');
    // No verdict field of any kind is synthesized by the tool.
    for (const banned of ['recommendation', 'verdict', 'rating', 'decision', 'approved']) {
      expect(Object.keys(result)).not.toContain(banned);
    }
  });
});

describe('presentMyDeliveryReceipts', () => {
  it('mints a fresh token for the configured subject and returns its receipts', async () => {
    const client = fakeClient({
      mintShareToken: vi.fn(async () => ({ token: 'crd_share_abc', verifyUrl: 'https://api.credda.io/api/v1/verify/crd_share_abc' })),
      getDeliveryReceipts: vi.fn(async () => RECEIPTS),
    });
    const result = await presentMyDeliveryReceipts({ client, apiKey: 'crd_live_k', selfUserId: 'agent-1', issuerDid: TEST_ISSUER });
    expect(client.mintShareToken).toHaveBeenCalledWith('agent-1', 'crd_live_k');
    expect(client.getDeliveryReceipts).toHaveBeenCalledWith('crd_share_abc');
    expect(result.token).toBe('crd_share_abc');
    expect(result.receipts.deliveryRecord.confirmedDeliveries).toBe(9);
  });

  it('refuses without CREDDA_API_KEY / CREDDA_USER_ID: it never acts for a counterparty', async () => {
    const client = fakeClient();
    await expect(presentMyDeliveryReceipts({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    await expect(presentMyDeliveryReceipts({ client, apiKey: 'k', issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_USER_ID/);
  });
});

// ── Requesting a confirmation (the only tool that ASKS for anything) ──────────
//
// The point of these tests is the asymmetry. `requestConfirmation` may create a
// PENDING ask; nothing in this module may turn that ask into a confirmed
// outcome. Every assertion below exists to keep that true under later edits.

const CREATED = {
  confirmation: {
    id: 'cfr_123',
    subjectExternalId: 'ext_worker_1',
    eventType: 'CONTRACT_FULFILLED',
    stakeLevel: 'MEDIUM',
    transactionValue: null,
    dueDate: null,
    completedAt: '2026-08-01T00:00:00.000Z',
    counterpartyRef: 'client_44',
    counterpartyName: 'Bramley Care Home',
    description: 'Night shift, 1 August',
    claimRef: null,
    returnUrl: null,
    status: 'PENDING' as const,
    expiresAt: '2026-08-31T00:00:00.000Z',
    resultingEventId: null,
    decidedAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
  },
  confirmationToken: 'one_time_raw_token',
  confirmUrl: 'https://api.credda.io/confirm/cfr_123?token=one_time_raw_token',
  previewUrl: 'https://api.credda.io/api/v1/confirmations/cfr_123/preview?token=one_time_raw_token',
  respondUrl: 'https://api.credda.io/api/v1/confirmations/cfr_123/respond',
};

describe('requestConfirmation', () => {
  it('creates a PENDING ask with the configured key and hands back the delivery link', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn(async () => CREATED) });
    const ctx: ToolContext = { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER };
    const result = await requestConfirmation(ctx, {
      userId: 'ext_worker_1',
      eventType: 'CONTRACT_FULFILLED',
      counterpartyRef: 'client_44',
      counterpartyName: 'Bramley Care Home',
      description: 'Night shift, 1 August',
      completedAt: '2026-08-01T00:00:00.000Z',
    });

    const [body, key, opts] = (client.createConfirmationRequest as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe('crd_live_xyz');
    expect(body.userId).toBe('ext_worker_1');
    expect(body.eventType).toBe('CONTRACT_FULFILLED');
    // Passed through untouched so the server's own CONFIRMATION_SELF check is
    // the one that decides whether the subject is naming itself as its witness.
    expect(body.counterpartyRef).toBe('client_44');
    expect(opts).toEqual({});

    expect(result.id).toBe('cfr_123');
    expect(result.status).toBe('PENDING');
    expect(result.confirmUrl).toBe(CREATED.confirmUrl);
    // Nothing was recorded: the ledger event id is null and stays null until
    // the counterparty acts.
    expect(result.resultingEventId).toBeNull();
  });

  it('names the configured subject when userId is omitted', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn(async () => CREATED) });
    await requestConfirmation(
      { client, apiKey: 'crd_live_xyz', selfUserId: 'ext_worker_1', issuerDid: TEST_ISSUER },
      { eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44' },
    );
    const [body] = (client.createConfirmationRequest as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.userId).toBe('ext_worker_1');
  });

  it('forwards an idempotency key so a retry cannot mint a second token', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn(async () => CREATED) });
    await requestConfirmation(
      { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER },
      { userId: 'ext_worker_1', eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44', idempotencyKey: 'shift_998' },
    );
    const [, , opts] = (client.createConfirmationRequest as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ idempotencyKey: 'shift_998' });
  });

  it('refuses without CREDDA_API_KEY, and calls nothing', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn() });
    await expect(
      requestConfirmation({ client, issuerDid: TEST_ISSUER }, { userId: 'ext_worker_1', eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44' }),
    ).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.createConfirmationRequest).not.toHaveBeenCalled();
  });

  it('refuses when no subject is named and none is configured', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn() });
    await expect(
      requestConfirmation({ client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER }, { eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44' }),
    ).rejects.toThrow(/userId/);
    expect(client.createConfirmationRequest).not.toHaveBeenCalled();
  });

  it('states plainly that nothing is on the ledger and that the caller owns delivery', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn(async () => CREATED) });
    const result = await requestConfirmation(
      { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER },
      { userId: 'ext_worker_1', eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44' },
    );
    // An agent reads these strings; they must not let it believe it has just
    // verified something, or that Credda will do the delivering.
    expect(result.ledger).toMatch(/nothing/i);
    expect(result.delivery).toMatch(/your own channel/i);
    expect(result.delivery).toMatch(/no email/i);
  });

  it('hands back no recipe for answering on the counterparty\'s behalf', async () => {
    const client = fakeClient({ createConfirmationRequest: vi.fn(async () => CREATED) });
    const result = await requestConfirmation(
      { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER },
      { userId: 'ext_worker_1', eventType: 'CONTRACT_FULFILLED', counterpartyRef: 'client_44' },
    );
    // The hosted page is the deliverable. The bare token and the POST target
    // the counterparty's browser uses are deliberately not surfaced to a model.
    expect(Object.keys(result)).not.toContain('respondUrl');
    expect(Object.keys(result)).not.toContain('confirmationToken');
    expect(JSON.stringify(result)).not.toContain('/respond');
  });
});

describe('listConfirmationRequests', () => {
  it('lists under the configured key and passes the filter through', async () => {
    const page = { data: [CREATED.confirmation], nextCursor: null };
    const client = fakeClient({ listConfirmations: vi.fn(async () => page) });
    const result = await listConfirmationRequests(
      { client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER },
      { status: 'PENDING', limit: 25, cursor: 'c1' },
    );
    expect(client.listConfirmations).toHaveBeenCalledWith('crd_live_xyz', {
      status: 'PENDING',
      limit: 25,
      cursor: 'c1',
    });
    expect(result).toBe(page);
  });

  it('sends no filter at all when none is given', async () => {
    const client = fakeClient({ listConfirmations: vi.fn(async () => ({ data: [], nextCursor: null })) });
    await listConfirmationRequests({ client, apiKey: 'crd_live_xyz', issuerDid: TEST_ISSUER });
    expect(client.listConfirmations).toHaveBeenCalledWith('crd_live_xyz', {});
  });

  it('refuses without CREDDA_API_KEY', async () => {
    const client = fakeClient({ listConfirmations: vi.fn() });
    await expect(listConfirmationRequests({ client, issuerDid: TEST_ISSUER })).rejects.toThrow(/CREDDA_API_KEY/);
    expect(client.listConfirmations).not.toHaveBeenCalled();
  });
});
