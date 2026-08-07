#!/usr/bin/env node
/**
 * Credda trust MCP server — stdio entrypoint.
 *
 * Gives an AI agent (Claude Desktop, Claude Code, or any MCP client) direct
 * access to Credda's verifiable, bias-free trust layer: look up a
 * counterparty's deterministic reliability score, offline-verify a credential
 * they present, and mint your own to present back. With CREDDA_API_KEY set it
 * also gets the platform surface: read/explain your own users' scores, manage
 * continuous score monitors (edge-triggered `monitor.triggered` webhooks), and
 * read the key's own usage/quota. No config needed for the public read/verify
 * tools (public /verify endpoints + the webhook event catalog); set
 * CREDDA_API_KEY for the platform tools, plus CREDDA_USER_ID for
 * mint_my_trust_token / present_my_credential.
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
    selfUserId: process.env.CREDDA_USER_ID,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('credda-mcp: fatal error', err);
  process.exit(1);
});
