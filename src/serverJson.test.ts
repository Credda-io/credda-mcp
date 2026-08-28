/**
 * Drift guard for the MCP Registry listing (`server.json`).
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
 * Since 1.0.0 it also guards the pivot: this package was published for two
 * minor versions describing a trust/score product that no longer exists, and a
 * listing that still describes it would be the most visible place that lie
 * survives.
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
const readText = (name: string) => readFileSync(join(here, '..', name), 'utf8');
const read = (name: string) => JSON.parse(readText(name));

const serverJson = read('server.json');
const pkg = read('package.json');

/**
 * The namespace the registry grants a GitHub Actions OIDC token is
 * `io.github.<repository_owner>/*`, matched as a CASE-SENSITIVE prefix
 * (registry `internal/auth/jwt.go` -> `isResourceMatch`). The org login is
 * `Credda-io`, so lowercasing this would 403 at publish.
 */
const NAMESPACE = 'io.github.Credda-io/';

const npmPackage = () =>
  serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');

describe('MCP Registry listing (server.json)', () => {
  it('carries the fields the schema makes required', () => {
    // ServerDetail requires name, description and version; a package entry
    // requires registryType, identifier and transport.
    for (const field of ['name', 'description', 'version']) {
      expect(typeof serverJson[field]).toBe('string');
    }
    expect(serverJson.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(serverJson.description.length).toBeGreaterThan(0);
    expect(serverJson.description.length).toBeLessThanOrEqual(100); // schema maxLength
    // A version RANGE is rejected by the schema; only an exact version listed.
    for (const version of [serverJson.version, npmPackage().version]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(npmPackage().identifier).toBeTruthy();
    expect(npmPackage().transport.type).toBe('stdio');
  });

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
    expect(npmPackage()).toBeDefined();
    expect(npmPackage().identifier).toBe(pkg.name);
    expect(npmPackage().version).toBe(pkg.version);
    expect(serverJson.version).toBe(pkg.version);
  });

  it('declares exactly the env vars the entrypoint actually reads', () => {
    const declared = npmPackage()
      .environmentVariables.map((v: { name: string }) => v.name)
      .sort();
    const entrypoint = readFileSync(join(here, 'index.ts'), 'utf8');
    const actual = [...entrypoint.matchAll(/process\.env\.(CREDDA_[A-Z_]+)/g)].map((m) => m[1]);
    expect(declared).toEqual([...new Set(actual)].sort());
  });

  it('marks the API key secret, and requires nothing (a local install has auth disabled)', () => {
    const byName = Object.fromEntries(
      npmPackage().environmentVariables.map((v: { name: string }) => [v.name, v]),
    );
    expect(byName.CREDDA_API_KEY.isSecret).toBe(true);
    expect(byName.CREDDA_API_BASE.isSecret).toBe(false);
    for (const v of npmPackage().environmentVariables) {
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

  it('no longer describes the retired trust product, anywhere a user reads it', () => {
    // 0.x of this package was a trust/score server. Those words in the listing
    // or the npm description would keep selling a product that is gone.
    const copy = `${serverJson.title} ${serverJson.description} ${pkg.description} ${pkg.keywords.join(' ')}`.toLowerCase();
    for (const word of ['trust', 'reliability score', 'counterparty', 'verifiable credential', 'share token']) {
      expect(copy).not.toContain(word);
    }
  });

  it('does not advertise, in the listing, a capability this server does not have', () => {
    // The PRODUCT opens pull requests. This SERVER reads. A listing that blurs
    // the two is how a model ends up asked to do something no tool here can.
    const copy = `${serverJson.title} ${serverJson.description} ${pkg.description}`.toLowerCase();
    // "it cannot open a pull request" is the sentence we WANT. An affirmative
    // one is the failure, so each sentence naming the capability must deny it.
    for (const sentence of copy.split(/[.;]/)) {
      if (/pull request|writes the patch|opens? a run|starts? a run/.test(sentence)) {
        expect(sentence, sentence).toMatch(/cannot|never|does not/);
      }
    }
    for (const phrase of ['fixes your code', 'fixes your bugs']) {
      expect(copy).not.toContain(phrase);
    }
    expect(pkg.description.toLowerCase()).toContain('read-only');
  });

  it('is a major version, because the published name changed meaning', () => {
    // 0.2.0 of `@credda/mcp-server` is a different product under the same name.
    // The bump is the only signal an installed consumer gets; the CHANGELOG is
    // where it is explained, and it must say so at this version.
    expect(Number(pkg.version.split('.')[0])).toBeGreaterThanOrEqual(1);
    const changelog = readText('CHANGELOG.md');
    expect(changelog).toContain(`## ${pkg.version}`);
    expect(changelog.toLowerCase()).toContain('breaking');
  });
});

/**
 * The string every MCP client actually displays.
 *
 * `serverInfo` is returned by the `initialize` handshake and is what Claude
 * Desktop, Claude Code, and every other client show in their server list. It
 * was a hardcoded literal for the entire published life of the package while
 * package.json and the registry listing moved on. Nothing read it, so nothing
 * caught it.
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
