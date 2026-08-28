#!/usr/bin/env node
/**
 * Credda MCP server (stdio entrypoint).
 *
 * Gives an MCP client (Claude Desktop, Claude Code, or any other) read access
 * to what Credda found in a repository: investigations and their evidence,
 * resolution records, and validation runs with their checks and findings.
 *
 * It is read-only by construction. It cannot start an investigation, spend a
 * model budget, or open a pull request -- see README.md and
 * src/writeSurface.test.ts.
 *
 * Usage (e.g. in a Claude Desktop / Claude Code MCP config):
 *   { "command": "npx", "args": ["-y", "@credda/mcp-server"] }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

async function main() {
  const server = buildServer({
    apiBase: process.env.CREDDA_API_BASE,
    apiKey: process.env.CREDDA_API_KEY,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('credda-mcp: fatal error', err);
  process.exit(1);
});
