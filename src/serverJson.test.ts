/**
 * Drift guard for the MCP Registry listing (`packages/mcp/server.json`).
 *
 * The registry format forces us to restate things the package already knows:
 * the npm package name, its version, and the registry server name (which npm
 * ownership verification reads back out of the published `package.json` as
 * `mcpName`). That is exactly the "copied constant goes stale" class this repo
 * has been bitten by before, and it fails LOUDLY here rather than quietly at
 * publish time: the registry refuses a listing whose npm release does not carry
 * a matching `mcpName`, and it refuses a namespace that is not the one the
 * GitHub OIDC token grants.
 *
 * Every tool listed in server-facing docs is registered in `server.ts`; the
 * listing itself only carries name/description/env, so there is nothing else to
 * cross-check here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(here, '..', name), 'utf8'));

const serverJson = read('server.json');
const pkg = read('package.json');

/**
 * The namespace the registry grants a GitHub Actions OIDC token is
 * `io.github.<repository_owner>/*`, matched as a CASE-SENSITIVE prefix
 * (registry `internal/auth/jwt.go` → `isResourceMatch`). The org login is
 * `Credda-io`, so lowercasing this would 403 at publish.
 */
const NAMESPACE = 'io.github.Credda-io/';

describe('MCP Registry listing (server.json)', () => {
  it('is published under the namespace our GitHub OIDC token can claim', () => {
    expect(serverJson.name.startsWith(NAMESPACE)).toBe(true);
  });

  it('carries the ownership marker npm verification reads back', () => {
    // The registry fetches the npm version metadata and requires
    // `mcpName === server.json name`. Without this the publish fails with
    // "NPM package ... is missing required 'mcpName' field".
    expect(pkg.mcpName).toBe(serverJson.name);
  });

  it('points at this exact package and version', () => {
    const npmPackage = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    expect(npmPackage).toBeDefined();
    expect(npmPackage.identifier).toBe(pkg.name);
    expect(npmPackage.version).toBe(pkg.version);
    expect(serverJson.version).toBe(pkg.version);
  });

  it('declares exactly the env vars the entrypoint actually reads', () => {
    const npmPackage = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    const declared = npmPackage.environmentVariables.map((v: { name: string }) => v.name).sort();
    const entrypoint = readFileSync(join(here, 'index.ts'), 'utf8');
    const actual = [...entrypoint.matchAll(/process\.env\.(CREDDA_[A-Z_]+)/g)].map((m) => m[1]);
    expect(declared).toEqual([...new Set(actual)].sort());
  });

  it('marks the API key secret and nothing as required (the public tools need no config)', () => {
    const npmPackage = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    const byName = Object.fromEntries(
      npmPackage.environmentVariables.map((v: { name: string }) => [v.name, v]),
    );
    expect(byName.CREDDA_API_KEY.isSecret).toBe(true);
    for (const v of npmPackage.environmentVariables) {
      expect(v.isRequired).toBe(false);
    }
  });

  it('is not the only place the version is stated, but is the only place it is typed', () => {
    // Sanity: the runtime identity below and this listing read the SAME
    // package.json, so these can never disagree. Stated explicitly so a future
    // edit that reintroduces a literal fails here too.
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(`${NAMESPACE}${SERVER_NAME}`).toBe(serverJson.name);
  });

  it('describes what the server does without rendering a verdict on anyone', () => {
    // Standing refusal (CLAUDE.md / docs/ROADMAP.md): Credda explains evidence,
    // it never rates, scores-as-a-judgement, or recommends a person or an agent.
    // A public listing is exactly where that copy slips.
    const copy = `${serverJson.title} ${serverJson.description}`.toLowerCase();
    for (const word of ['rate', 'rating', 'evaluate', 'assess', 'judge', 'recommend', 'risk score', 'vet']) {
      expect(copy).not.toContain(word);
    }
    expect(serverJson.description.length).toBeLessThanOrEqual(100); // schema maxLength
  });
});

/**
 * The string every MCP client actually displays.
 *
 * `serverInfo` is returned by the `initialize` handshake and is what Claude
 * Desktop, Claude Code, and every other client show in their server list. It
 * was a hardcoded `{ name: 'credda-trust', version: '0.0.1' }` for the entire
 * published life of the package, while package.json and the registry listing
 * were both at 0.1.3. Nothing read it, so nothing caught it.
 *
 * This runs the real handshake over an in-memory transport pair rather than
 * reading a private field, because the private field is not the contract; what
 * comes back over the wire is.
 */
describe('serverInfo reported over the initialize handshake', () => {
  async function handshake() {
    const server = buildServer();
    const client = new Client({ name: 'drift-guard', version: '0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const info = client.getServerVersion();
    await client.close();
    await server.close();
    return info;
  }

  it('reports the published package version, not a literal that can drift', async () => {
    const info = await handshake();
    expect(info?.version).toBe(pkg.version);
  });

  it('reports the name the registry listing is published under', async () => {
    const info = await handshake();
    // server.json name is the namespaced form; serverInfo carries the bare name.
    expect(info?.name).toBe(serverJson.name.slice(NAMESPACE.length));
  });
});
