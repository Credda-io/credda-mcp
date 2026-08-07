/**
 * The identity this server reports to every MCP client in `serverInfo`.
 *
 * Read out of `package.json` at runtime rather than restated as a literal.
 * The literal drifted once already: `serverInfo` shipped `0.0.1` for the whole
 * life of the package while `package.json` and the MCP Registry listing were
 * both at `0.1.3`, and every client displayed the wrong string. There is no
 * mechanism that would have caught that, because nothing else read it.
 *
 * `new URL('../package.json', import.meta.url)` resolves to the package root
 * from BOTH layouts: `src/version.ts` in a checkout and `dist/version.js` in
 * the published tarball. npm always packs `package.json` regardless of the
 * `files` allowlist, so this cannot go missing for a consumer.
 *
 * A JSON import would be tidier, but `rootDir` is `src` and `package.json`
 * sits above it, so the emitted `dist/` layout would shift. Reading the file
 * keeps the build output flat.
 */

import { readFileSync } from 'node:fs';

interface PackageManifest {
  version: string;
  mcpName: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

/**
 * The bare server name, e.g. `credda-trust`. The registry namespaces it as
 * `io.github.Credda-io/credda-trust` (`mcpName`), and npm ownership
 * verification reads that value back out of the published `package.json`, so
 * the last segment is the single source of truth for both.
 */
export const SERVER_NAME = manifest.mcpName.split('/').pop() as string;

/** The published package version, verbatim. */
export const SERVER_VERSION = manifest.version;
