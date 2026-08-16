/**
 * The write surface of the MCP server, locked open at exactly one hole.
 *
 * `request_confirmation` is the first tool here that is not a read. It may
 * create a PENDING ask. It may not, and nothing else in this package may,
 * produce a CONFIRMED one: the verified event is written only by
 * `POST /api/v1/confirmations/:id/respond`, which takes no API key because the
 * counterparty holds a one-time token instead, and which this server does not
 * wrap. That asymmetry IS the product. If a later edit adds a respond tool, or
 * routes an agent to the raw respond endpoint, an agent could manufacture a
 * verified outcome with no counterparty in the loop, and every score built on
 * this ledger becomes worth less. These tests fail loudly if that happens.
 *
 * Two independent guards, because either alone is defeatable:
 *   1. over the wire: what `listTools()` actually advertises to a model;
 *   2. over the source: which client methods `tools.ts` is allowed to name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));

async function listTools() {
  const server = buildServer({ apiKey: 'crd_live_test', selfUserId: 'ext_self' });
  const client = new Client({ name: 'write-surface-guard', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

describe('the confirmation tools are actually advertised', () => {
  it('registers request_confirmation and list_confirmation_requests', async () => {
    const names = (await listTools()).map((t) => t.name);
    expect(names).toContain('request_confirmation');
    expect(names).toContain('list_confirmation_requests');
  });

  it('asks for the counterparty, never for a decision', async () => {
    const tool = (await listTools()).find((t) => t.name === 'request_confirmation');
    const props = Object.keys((tool?.inputSchema as { properties?: object }).properties ?? {});
    expect(props).toContain('counterpartyRef');
    // A `decision` / `confirm` input would be the shape of a tool that answers
    // on the counterparty's behalf. There is no such input, by construction.
    expect(props).not.toContain('decision');
    expect(props).not.toContain('confirm');
    expect(props).not.toContain('token');
  });
});

describe('no tool can produce a confirmed outcome', () => {
  it('advertises no tool that responds to, confirms, or declines an ask', async () => {
    const names = (await listTools()).map((t) => t.name);
    for (const banned of [
      'respond_to_confirmation',
      'confirm_outcome',
      'decline_confirmation',
      'answer_confirmation',
      'report_event',
      'create_event',
      'record_event',
    ]) {
      expect(names).not.toContain(banned);
    }
    // Broader than the list above: nothing whose name reads as answering an ask.
    for (const name of names) {
      expect(name).not.toMatch(/respond|decline|_confirm$|^confirm_/);
    }
  });

  it('never offers to confirm on someone else\'s behalf in its own copy', async () => {
    const tools = await listTools();
    const copy = tools.map((t) => `${t.title ?? ''} ${t.description ?? ''}`).join(' ').toLowerCase();
    for (const phrase of [
      'confirm on behalf',
      'confirm for them',
      'auto-confirm',
      'automatically confirm',
      'mark as confirmed',
    ]) {
      expect(copy).not.toContain(phrase);
    }
  });

  it('the handlers never reach for a client method that writes an outcome', () => {
    // Comments are stripped so this guards what the module DOES, not what a
    // future comment is allowed to mention.
    const code = readFileSync(join(here, 'tools.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // `CreddaClient` can do all of these. This package may not.
    for (const method of ['respondToConfirmation', 'respondToReference', 'reportEvent', 'ingestEvents']) {
      expect(code).not.toContain(method);
    }
    // `confirmUrl` is the one delivery link surfaced. `confirmationToken`,
    // `respondUrl` and `previewUrl` arrive on the same API response and are
    // dropped on the floor: an agent that never sees the POST target is one
    // step further from answering the ask itself.
    expect(code).toContain('confirmUrl');
    expect(code).not.toContain('respondUrl');
    expect(code).not.toContain('previewUrl');
    expect(code).not.toContain('confirmationToken');
  });
});
