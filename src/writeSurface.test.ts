/**
 * The write surface of this MCP server, locked shut.
 *
 * WHAT THIS GUARANTEES, AND WHY IT IS THE SAME GUARANTEE AS BEFORE. The
 * pre-pivot server exposed a trust ledger, and this file existed to prove that
 * nothing it advertised could write to that ledger or move anyone's score. The
 * product changed; the reason for the file did not. An MCP server is driven by
 * a model, and the model's context is filled -- by this very server -- with
 * issue text, logs and diffs out of somebody's repository. So the tools it
 * advertises must not be able to do anything that costs money or changes
 * somebody's code:
 *
 *   1. it cannot start an investigation, which spends a model budget on a
 *      customer's account;
 *   2. it cannot open, update or merge a pull request in anybody's repository;
 *   3. it cannot apply a patch anywhere.
 *
 * THE ENGINE'S TWO WRITE ROUTES EXIST AND ARE DELIBERATELY NOT WRAPPED.
 * `apps/api/src/routes/investigations.ts` accepts `POST /api/investigations`
 * and creates a run in `CREATED`, and accepts
 * `POST /api/investigations/{id}/cancel` and stops one. They are the only
 * non-GET routes on the API and the only ones that change anything, and a tool
 * for either would put "start a run" -- or "stop somebody's run" -- one
 * jailbroken issue body away. An operator does both with the CLI, deliberately,
 * as themselves. If a later edit exposes one, these tests fail, and the README
 * must be changed in the same commit to say so.
 *
 * This file proves the surface is GET-only. It cannot notice a THIRD write
 * route the engine gains, because it has no list of what the engine serves;
 * `src/routeSurface.test.ts` holds that list, from the engine's own generated
 * route surface, and requires every unwrapped route to carry a reason.
 *
 * Three independent guards, because each alone is defeatable:
 *   1. over the wire: what `listTools()` advertises, and its annotations;
 *   2. over the socket: every advertised tool is actually invoked, and every
 *      HTTP request that comes out of it must be a GET;
 *   3. over the source: which verbs and paths the modules are allowed to name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));

const source = (name: string) =>
  readFileSync(join(here, name), 'utf8')
    // Comments are stripped so these guard what the modules DO, not what a
    // comment is allowed to mention -- this file's own prose names POST.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

interface JsonSchema {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

async function withClient<T>(
  fetchImpl: typeof fetch,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const server = buildServer({ apiBase: 'http://api.test', apiKey: 'k', fetchImpl });
  const client = new Client({ name: 'write-surface-guard', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const okFetch: typeof fetch = async () =>
  new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

async function listTools() {
  return withClient(okFetch, async (c) => (await c.listTools()).tools);
}

/** The smallest argument object the tool's own schema will accept. */
function minimalArgs(schema: JsonSchema): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const type = schema.properties?.[name]?.type;
    args[name] = type === 'number' || type === 'integer' ? 1 : type === 'boolean' ? false : 'x';
  }
  return args;
}

describe('the tools that are advertised are the read tools', () => {
  it('advertises every read tool and nothing else', async () => {
    const names = (await listTools()).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_api_health',
        'get_investigation',
        'get_latest_resolution',
        'get_repository',
        'get_resolution',
        'get_validation',
        'list_investigation_evidence',
        'list_investigation_events',
        'list_investigations',
        'list_repositories',
        'list_repository_learnings',
        'list_resolutions',
        'list_validation_checks',
        'list_validation_events',
        'list_validation_evidence',
        'list_validation_findings',
        'list_validations',
      ].sort(),
    );
  });

  it('marks every tool read-only and non-destructive to the client', async () => {
    for (const tool of await listTools()) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });

  it('advertises no tool that starts work or touches a repository', async () => {
    const names = (await listTools()).map((t) => t.name);
    for (const banned of [
      'create_investigation',
      'start_investigation',
      'run_investigation',
      'investigate',
      'open_pull_request',
      'create_pull_request',
      'merge_pull_request',
      'apply_patch',
      'submit_fix',
      'approve_resolution',
    ]) {
      expect(names).not.toContain(banned);
    }
    // Broader than the list: nothing whose NAME reads as causing something.
    for (const name of names) {
      expect(name).not.toMatch(
        /^(create|start|run|trigger|queue|launch|open|apply|submit|merge|approve|retry|cancel|delete|update|write|post|patch|fix)_/,
      );
    }
  });

  it('never offers, in its own copy, to start a run or open a pull request', async () => {
    const copy = (await listTools())
      .map((t) => `${t.title ?? ''} ${t.description ?? ''}`)
      .join(' ')
      .toLowerCase();
    for (const phrase of [
      'start an investigation',
      'starts an investigation',
      'open a pull request',
      'opens a pull request',
      'apply the patch',
      'applies the patch',
      'merge',
    ]) {
      expect(copy).not.toContain(phrase);
    }
  });

  it('says the repository content it returns is untrusted, and claims no filtering', async () => {
    // The tools that carry repository or report text must say what it is. This
    // is a statement about the content, not a mitigation: see the note in
    // tools.ts, and the README section that repeats it.
    const tools = await listTools();
    const carriers = tools.filter((t) => t.name !== 'get_api_health' && t.name !== 'list_repositories');
    for (const tool of carriers) {
      expect(tool.description?.toLowerCase(), tool.name).toContain('untrusted');
    }
    /* PER TOOL, and it was not. This joined every description into one string
     * and allowed the overclaims anywhere in it as long as the phrase
     * "nothing here filters it" appeared somewhere in it too -- so one tool's
     * disclaimer licensed "sanitised" in all sixteen others, which is the
     * opposite of what a per-tool description is for. The escape hatch is
     * still available, to the tool that spends it. */
    for (const tool of tools) {
      const copy = (tool.description ?? '').toLowerCase();
      const disclaims = copy.includes('nothing here filters it');
      for (const overclaim of ['sanitis', 'sanitiz', 'safe to trust', 'injection-proof']) {
        expect(copy.includes(overclaim) && !disclaims, `${tool.name} claims "${overclaim}"`).toBe(
          false,
        );
      }
    }
  });

  /**
   * The README's one sentence about paging, held to the schemas.
   *
   * It read: "All of them page with `limit` (1-100, API default 50) and
   * `offset` unless noted", and only `get_api_health` was noted. Five more
   * tools take no page window at all, and the two event listings take
   * `limit` up to 1000 rather than 100 -- so the sentence was wrong about
   * seven of seventeen tools, in the section a caller reads to find out what
   * they can ask for. Nothing compared it to a schema.
   */
  it('pages exactly where the README says it pages', async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(10);

    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    const paging = /Most page with[\s\S]*?\n\n/.exec(readme)?.[0] ?? '';
    expect(paging, 'README no longer has the paging sentence this test checks').not.toBe('');

    const properties = (tool: (typeof tools)[number]) =>
      ((tool.inputSchema as JsonSchema).properties ?? {}) as Record<string, { maximum?: number }>;

    const unpaged = tools.filter((t) => properties(t)['limit'] === undefined).map((t) => t.name);
    /* Any bound that is not the ordinary 1-100 is an exception too, whatever
     * it is. Naming 1000 here would have hidden the third value: the two event
     * listings do not even agree with each other -- investigation events cap
     * at 1000 and validation events at 500. */
    const wide = tools
      .filter((t) => {
        const max = properties(t)['limit']?.maximum;
        return max !== undefined && max !== 100;
      })
      .map((t) => t.name);

    expect(unpaged.length + wide.length).toBeGreaterThan(0);
    for (const name of [...unpaged, ...wide]) {
      expect(paging, `${name} is an exception to the paging sentence and is not named in it`).
        toContain(name);
    }
    /* A wider bound has to be the bound the README prints, not merely a
     * mention of the tool: naming it and stating the wrong number is the
     * failure this paragraph already had. */
    for (const tool of tools) {
      const max = properties(tool)['limit']?.maximum;
      if (max === undefined || max === 100) continue;
      expect(paging, `${tool.name} caps limit at ${String(max)} and the README does not say so`).
        toContain(`1\u2013${String(max)}`);
    }
    /* And nothing is named as an exception that is not one. */
    for (const named of paging.match(/`([a-z_]+)`/g) ?? []) {
      const name = named.replaceAll('`', '');
      if (!tools.some((t) => t.name === name)) continue;
      expect([...unpaged, ...wide], `${name} is named as an exception and pages normally`).
        toContain(name);
    }
  });
});

describe('every advertised tool, actually invoked, issues only GETs', () => {
  it('drives all of them and sees no other verb, and no body', async () => {
    const calls: { method: string; url: string; hasBody: boolean }[] = [];
    const recording: typeof fetch = async (input, init) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input),
        hasBody: init?.body !== undefined && init?.body !== null,
      });
      return okFetch(input, init);
    };

    await withClient(recording, async (client) => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        await client.callTool({
          name: tool.name,
          arguments: minimalArgs(tool.inputSchema as JsonSchema),
        });
      }
      // Every tool was exercised; a tool that made no request would hide here.
      expect(calls.length).toBe(tools.length);
    });

    for (const call of calls) {
      expect(call.method, call.url).toBe('GET');
      expect(call.hasBody, call.url).toBe(false);
    }
    // The one route on the API that causes work is never reached, by any tool.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

describe('the source cannot express a write', () => {
  it('the client has exactly one HTTP verb and it is GET', () => {
    const code = source('apiClient.ts');
    const verbs = [...code.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
    expect(verbs).toEqual(['GET']);
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(code).not.toContain(`'${verb}'`);
    }
    // No second door: handlers go through this client, not through fetch.
    expect(source('tools.ts')).not.toContain('fetch(');
  });

  it('no handler and no registration names a write verb or a create path', () => {
    for (const file of ['tools.ts', 'server.ts', 'index.ts']) {
      const code = source(file);
      for (const verb of ["'POST'", "'PUT'", "'PATCH'", "'DELETE'", '.post(', '.delete(']) {
        expect(code, file).not.toContain(verb);
      }
      // `POST /api/investigations` is the route this package refuses to wrap.
      // Every mention of that path in these modules must be a GET of a
      // sub-resource or of the collection, never a request that creates one.
      expect(code, file).not.toMatch(/create[A-Za-z]*Investigation/);
    }
  });

  it('the API base can be overridden but the path is never taken from the caller', () => {
    // A `path` argument on a tool would be a generic HTTP client wearing a
    // read-only label: the model would choose the route, verb aside.
    const code = source('server.ts');
    expect(code).not.toMatch(/inputSchema:\s*{[^}]*\bpath\b/);
    expect(code).not.toMatch(/\bendpoint:\s*z\./);
  });
});
