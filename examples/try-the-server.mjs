/**
 * A worked example: talk to this server the way an MCP client does.
 *
 *     npm run example
 *
 * It needs no key, no account and no network. The Credda API is a stub HTTP
 * server started below on loopback, and the server under test is the BUILT
 * one -- `node dist/index.js`, spawned over a real stdio transport, exactly as
 * an MCP client config launches it. So this is also the only check that the
 * published binary starts at all: the unit suites build the server in-process
 * from `src/`, and would stay green if `dist/index.js` failed on boot.
 *
 * It lists the advertised tools, calls two of them, and asserts what comes
 * back -- including that the stub saw nothing but GETs, which is this package's
 * central promise about itself.
 *
 * The payloads are hand-written. This shows how the server is DRIVEN; it is not
 * evidence about the engine.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const API_KEY = 'stub-key-not-a-secret';
const ID = 'inv_7fa3';

/** Every request the stub was asked for, so the example can assert the verbs. */
const seen = [];

const api = createServer((req, res) => {
  seen.push(`${req.method} ${req.url.split('?')[0]}`);

  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Bearer token required' } }));
    return;
  }

  const path = req.url.split('?')[0];

  if (path === '/api/investigations') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        investigations: [
          {
            id: ID,
            repositoryId: 'repo_toolshed',
            repositorySource: 'https://github.com/Credda-io/toolshed',
            issueRef: 'https://github.com/Credda-io/toolshed/issues/3',
            issueTitle: 'Late fee is charged for the day the tool came back',
            state: 'READY_FOR_REVIEW',
            outcome: 'VERIFIED',
            eventCount: 6,
            evidenceCount: 2,
          },
        ],
        total: 1,
      }),
    );
    return;
  }

  if (path === `/api/investigations/${ID}`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        investigation: { id: ID, issueTitle: 'Late fee is charged for the day the tool came back', state: 'READY_FOR_REVIEW' },
        hypotheses: [
          {
            id: 'hyp_1',
            rank: 1,
            status: 'CONFIRMED',
            description: 'the due date is compared with `<` where the loan terms say `<=`',
          },
        ],
        patches: [
          {
            id: 'patch_1',
            status: 'VERIFIED',
            filesChanged: ['src/fees.ts'],
            diff: '--- a/src/fees.ts\n+++ b/src/fees.ts\n@@\n-  if (returned > due)\n+  if (startOfDay(returned) > startOfDay(due))\n',
          },
        ],
        verifications: [{ id: 'ver_1', verdict: 'VERIFIED' }],
        evidenceCount: 2,
        latestSequence: 6,
      }),
    );
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }));
});

api.listen(0, '127.0.0.1');
await once(api, 'listening');
const { port } = api.address();

const client = new Client({ name: 'credda-mcp-example', version: '0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'dist', 'index.js')],
  env: {
    PATH: process.env.PATH ?? '',
    CREDDA_API_BASE: `http://127.0.0.1:${port}`,
    CREDDA_API_KEY: API_KEY,
  },
});

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`\nThe server advertises ${tools.length} tools, all reads:`);
  for (const tool of tools) console.log(`  ${tool.name}`);
  assert.ok(tools.some((t) => t.name === 'list_investigations'));

  console.log('\nlist_investigations');
  const queue = JSON.parse((await client.callTool({ name: 'list_investigations', arguments: { limit: 5 } })).content[0].text);
  console.log(`  ${queue.investigations.length} of ${queue.total}: ${queue.investigations[0].issueTitle}`);
  console.log(`  state ${queue.investigations[0].state}, outcome ${queue.investigations[0].outcome}`);

  console.log('\nget_investigation');
  const run = JSON.parse(
    (await client.callTool({ name: 'get_investigation', arguments: { investigationId: ID } })).content[0].text,
  );
  console.log(`  cause: ${run.hypotheses[0].description}`);
  console.log(`  patch touches ${run.patches[0].filesChanged.join(', ')}, verdict ${run.verifications[0].verdict}`);
  assert.equal(run.investigation.id, ID);

  // The point of this package: a model driving it cannot start a run, cancel
  // one, apply a patch or open a pull request, because no tool here issues
  // anything but a GET.
  assert.deepEqual(
    [...new Set(seen.map((r) => r.split(' ')[0]))],
    ['GET'],
    `the stub saw a non-GET request: ${seen.join(', ')}`,
  );
  console.log(`\n${seen.length} requests reached the API, every one a GET.`);
  console.log(
    'The patch and its verdict are things Credda produced. Opening the pull\n' +
      'request is the engine\'s job, not this server\'s -- and nothing merges it.',
  );
} finally {
  await client.close().catch(() => undefined);
  api.close();
}
