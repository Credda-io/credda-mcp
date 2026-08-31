/**
 * What an MCP client is told when a call fails.
 *
 * WHY THIS EXISTS. `apiClient.ts` goes to some trouble over its failures: a 401
 * keeps the API's own words AND appends the name of the variable an MCP config
 * sets (`CREDDA_API_KEY`) and the base URL it tried; an unreachable API answers
 * `UNREACHABLE` naming the address; every other status surfaces the engine's
 * code and message rather than a bare number. `src/tools.test.ts` asserts all
 * of that against the client. Nothing asserted that any of it reaches the model.
 *
 * MEASURED 2026-08-30: replacing the body of `asToolError` in `server.ts` with
 * a plain `{ content: [{ type: 'text', text: 'null' }] }` -- no message, no
 * `isError` -- left all 61 tests passing. Every failure would have been
 * reported to the client as a successful result containing the word "null": a
 * misconfigured key, an API that is not running, and a deleted investigation
 * would all look like an empty answer, which is the reading a model would take
 * and act on. The catch that swallows is the whole defect; the tests that
 * existed could not see past it because none of them ever made a call fail.
 *
 * So this drives EVERY advertised tool into a failure and asserts the tool
 * result is marked an error and carries what the client wrote.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';

const API_BASE = 'http://api.test';

interface JsonSchema {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
}

async function withClient<T>(fetchImpl: typeof fetch, fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer({ apiBase: API_BASE, apiKey: 'wrong', fetchImpl });
  const client = new Client({ name: 'error-surface-guard', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
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

const failing = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

/** Every advertised tool, called once against `fetchImpl`. */
async function callEveryTool(fetchImpl: typeof fetch): Promise<[string, ToolResult][]> {
  return withClient(fetchImpl, async (client) => {
    const { tools } = await client.listTools();
    // An empty tool list would make every assertion below pass by having
    // nothing to check.
    expect(tools.length, 'no tools were advertised, so this checked nothing').toBeGreaterThan(10);
    const results: [string, ToolResult][] = [];
    for (const tool of tools) {
      results.push([
        tool.name,
        (await client.callTool({
          name: tool.name,
          arguments: minimalArgs(tool.inputSchema as JsonSchema),
        })) as ToolResult,
      ]);
    }
    return results;
  });
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((part) => part.text ?? '').join('\n');
}

describe('a failed call reaches the model as a failure', () => {
  it('marks every tool result an error when the key is refused, and says which variable to set', async () => {
    const results = await callEveryTool(
      failing(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid API key' } }),
    );
    for (const [name, result] of results) {
      expect(result.isError, `${name} did not report the 401 as an error`).toBe(true);
      const text = textOf(result);
      // The API's own words, and the guidance the client appends to them.
      expect(text, name).toContain('Invalid API key');
      expect(text, name).toContain('CREDDA_API_KEY');
      expect(text, name).toContain(API_BASE);
    }
  });

  it("passes the engine's own code and message through, not a bare status", async () => {
    const results = await callEveryTool(
      failing(404, { error: { code: 'NOT_FOUND', message: 'No such investigation: inv_9' } }),
    );
    for (const [name, result] of results) {
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toContain('No such investigation: inv_9');
    }
  });

  it('says where it tried to reach when the API is not running', async () => {
    const results = await callEveryTool((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    for (const [name, result] of results) {
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toContain(API_BASE);
    }
  });

  it('never answers a failure with something that reads as an empty result', async () => {
    /* The shape the swallow took: a result with no `isError` whose text is
     * `null`, `{}` or `[]` -- which a model reads as "there is nothing there"
     * rather than "the call did not happen". */
    const results = await callEveryTool(failing(500, { error: { code: 'INTERNAL', message: 'boom' } }));
    for (const [name, result] of results) {
      expect(result.isError, name).toBe(true);
      expect(['null', '{}', '[]', ''], name).not.toContain(textOf(result).trim());
    }
  });
});
