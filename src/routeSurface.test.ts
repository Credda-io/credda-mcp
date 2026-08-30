/**
 * The engine's route list, taken from the engine rather than transcribed.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT COMES FROM
 * ---------------------------------------------------------------------------
 * `route-surface.json` is generated in `core` by
 * `scripts/generate-route-surface.ts` out of `apps/api/src/openapi.ts` and
 * copied here. IT IS NOT EDITED BY HAND.
 *
 * The README carried a hand-kept table of the routes this server reads, grouped
 * by the engine file that defines them. A table like that cannot notice a route
 * the engine gains: it went stale on `GET /api/repositories/{id}`, and it went
 * on calling `POST /api/investigations` "the one write route" after
 * `POST /api/investigations/{id}/cancel` shipped on 2026-08-29. The same defect
 * left `credda-js` green at 102 tests with no `cancelInvestigation`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE ASSERTS, AND WHAT IT MUST NOT BE READ AS ASKING FOR
 * ---------------------------------------------------------------------------
 * Every route the engine serves is either wrapped by a tool or listed in
 * {@link UNWRAPPED} with a reason. AN UNWRAPPED ROUTE IS NOT A GAP TO FILL.
 * This server is read-only by design and `writeSurface.test.ts` enforces that
 * over the wire, over the socket and over the source; the two write routes are
 * here so that their absence is a recorded decision rather than an omission,
 * and adding a tool for either would fail that file rather than satisfy this
 * one. The value of listing them is that a THIRD write route the engine gains
 * fails here, by name, instead of arriving unnoticed.
 *
 * Staleness of the copy fails on both sides. Here: the digest stamped in the
 * file is recomputed over its own routes, so a copy hand-edited to make this
 * suite pass fails instead. In `core`: `route-surface.consumers.json` records
 * the digest this repository was last given, and `core`'s own suite fails -- in
 * CI, naming `credda-mcp` -- when the engine's surface moves past it.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';
import surface from './route-surface.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');

/** `"METHOD /path"` from the engine's surface to the tool that serves it. */
const TOOLS: Readonly<Record<string, string>> = {
  'GET /api/health': 'get_api_health',

  'GET /api/repositories': 'list_repositories',
  'GET /api/repositories/{id}': 'get_repository',
  'GET /api/repositories/{id}/learnings': 'list_repository_learnings',

  'GET /api/investigations': 'list_investigations',
  'GET /api/investigations/{id}': 'get_investigation',
  'GET /api/investigations/{id}/events': 'list_investigation_events',
  'GET /api/investigations/{id}/evidence': 'list_investigation_evidence',

  'GET /api/resolutions': 'list_resolutions',
  'GET /api/resolutions/latest': 'get_latest_resolution',
  'GET /api/resolutions/{id}': 'get_resolution',

  'GET /api/validations': 'list_validations',
  'GET /api/validations/{id}': 'get_validation',
  'GET /api/validations/{id}/checks': 'list_validation_checks',
  'GET /api/validations/{id}/findings': 'list_validation_findings',
  'GET /api/validations/{id}/evidence': 'list_validation_evidence',
  'GET /api/validations/{id}/events': 'list_validation_events',
};

/**
 * The routes this server deliberately does not wrap, each with the reason.
 * Deleting an entry here does not "fix" anything: it fails the suite until the
 * route is either wrapped or given a reason again.
 */
const UNWRAPPED: Readonly<Record<string, string>> = {
  'POST /api/investigations':
    'A write, and the route that spends a model budget on a customer account. Wrapping it would put "start a run" one jailbroken issue body away. Enforced, not promised, by writeSurface.test.ts.',
  'POST /api/investigations/{id}/cancel':
    'A write. Stopping a run is an operator decision and a tool for it would put "cancel somebody else\'s run" one jailbroken issue body away. Enforced by writeSurface.test.ts.',
  'GET /api/investigations/{id}/stream':
    'SSE. A long-lived stream has no shape in a request/response tool call; list_investigation_events with since is the same information, polled.',
  'GET /api/validations/{id}/stream':
    'SSE, for the same reason. list_validation_events with since is the same information, polled.',
  'GET /api/organization':
    'The organisation name, plan and counts. It says nothing about what Credda found, and the key already scopes every other tool to it.',
  'GET /api/organization/members':
    'Names and email addresses of colleagues. Personal data is not a thing to put in a model context incidentally.',
  'GET /api/organization/keys':
    'API key metadata. No secret is retrievable there, and it is still not something a model needs to enumerate.',
  'GET /api/metrics': 'Prometheus exposition, for a scraper rather than a reader.',
  'GET /livez': 'A liveness probe with no body. get_api_health answers the readiness question a caller actually has.',
  'GET /openapi.json':
    "The engine's own specification. A model that can call the tools above does not need the document describing routes it cannot reach.",
};

/** The write routes, named, so that "read-only by design" is a checked claim. */
const WRITE_ROUTES = ['POST /api/investigations', 'POST /api/investigations/{id}/cancel'];

const KEYS = surface.routes.map((route) => `${route.method} ${route.path}`);

/** The spelling the README uses for a path parameter. */
const readmePath = (key: string) => key.replace(/\{id\}/g, ':id');

async function advertisedTools(): Promise<string[]> {
  const server = buildServer({
    apiBase: 'http://api.test',
    apiKey: 'k',
    fetchImpl: async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const client = new Client({ name: 'route-surface-guard', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('the engine route surface', () => {
  it('holds a copy that has not been edited by hand', () => {
    const digest = `sha256-${createHash('sha256').update(JSON.stringify(surface.routes)).digest('hex')}`;
    expect(digest, 'src/route-surface.json was modified after generation; re-copy it from core').toBe(
      surface.digest,
    );
    expect(surface.routeCount).toBe(surface.routes.length);
    expect(surface.generator).toBe('scripts/generate-route-surface.ts');
  });

  it('accounts for every route the engine serves, as a tool or as a stated refusal', () => {
    const unaccounted = KEYS.filter((key) => !(key in TOOLS) && !(key in UNWRAPPED));
    expect(
      unaccounted,
      'the engine gained these routes and this server neither wraps them nor says why not. ' +
        'A read route wants an entry in TOOLS; a write route wants an entry in UNWRAPPED and NOT a tool.',
    ).toEqual([]);
    // Nothing claimed here that the engine no longer serves.
    expect([...Object.keys(TOOLS), ...Object.keys(UNWRAPPED)].filter((key) => !KEYS.includes(key))).toEqual([]);
    // A route may not be both.
    expect(Object.keys(TOOLS).filter((key) => key in UNWRAPPED)).toEqual([]);
  });

  it('gives every refusal a reason, not a silence', () => {
    for (const [key, reason] of Object.entries(UNWRAPPED)) {
      expect(reason.trim().length, `${key} is unwrapped with no reason`).toBeGreaterThan(40);
    }
  });

  it('wraps no write route, and names the ones it refuses', () => {
    const writes = KEYS.filter((key) => !key.startsWith('GET '));
    expect(writes, 'the engine gained a write route this file has not been told about').toEqual(WRITE_ROUTES);
    for (const key of WRITE_ROUTES) {
      expect(key in TOOLS, `${key} has been given a tool; this server is read-only by design`).toBe(false);
      expect(UNWRAPPED[key], `${key} is not listed as a deliberate refusal`).toBeTruthy();
    }
  });

  it('is exactly one tool per wrapped route, and no advertised tool without one', async () => {
    const mapped = Object.values(TOOLS);
    expect(new Set(mapped).size, 'a tool serves two routes').toBe(mapped.length);
    expect([...mapped].sort()).toEqual((await advertisedTools()).sort());
  });
});

describe('the README route table', () => {
  it('lists every wrapped route against the tool that serves it', () => {
    for (const [key, tool] of Object.entries(TOOLS)) {
      expect(
        readme.includes(`| \`${readmePath(key)}\` | \`${tool}\` |`),
        `README has no row for ${key} -> ${tool}`,
      ).toBe(true);
    }
  });

  it('names every route it does not wrap', () => {
    for (const key of Object.keys(UNWRAPPED)) {
      expect(readme.includes(`\`${readmePath(key)}\``), `README does not name the unwrapped route ${key}`).toBe(
        true,
      );
    }
  });

  it('claims no route the engine does not serve', () => {
    const claimed = [...readme.matchAll(/`((?:GET|POST) \/[^`]*)`/g)].map((m) => m[1]!);
    const known = new Set(KEYS.map(readmePath));
    expect([...new Set(claimed)].filter((c) => !known.has(c))).toEqual([]);
  });
});
