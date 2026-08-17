<p align="center">
  <a href="https://credda.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Credda-io/credda-mcp/main/assets/creddaseallockupdarktransparent.png">
      <img alt="Credda" src="https://raw.githubusercontent.com/Credda-io/credda-mcp/main/assets/creddaseallockuplighttransparent.png" width="480">
    </picture>
  </a>
</p>

> Source mirror for [`@credda/mcp-server`](https://www.npmjs.com/package/@credda/mcp-server). Install from npm: `npm install -g @credda/mcp-server`. Canonical development happens in Credda internal tooling; this repo is for source and issues.

# @credda/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that puts
[Credda](https://api.credda.io)'s verifiable trust layer in an agent's tool belt: look up a
counterparty's Credda record from a share token they hand you, offline-verify a credential they
present, and present your own back.

It is a thin client over Credda's public API: no database, no scoring logic. Nothing it exposes
can write to Credda's append-only event ledger or change anyone's score, and there is deliberately
**no** "evaluate this person" tool: it returns evidence, and the decision stays with the caller.

## Install

```json
{
  "mcpServers": {
    "credda": {
      "command": "npx",
      "args": ["-y", "@credda/mcp-server"]
    }
  }
}
```

`@credda/mcp-server` is on npm, so `npx` fetches it with no checkout and no
build. It is also listed in the
[MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.Credda-io/credda-trust`, so an MCP-aware client can discover it
without this config being pasted by hand.

That is enough for every public tool. Add credentials only for the platform tools:

```json
      "env": {
        "CREDDA_API_KEY": "crd_live_...",
        "CREDDA_USER_ID": "your-external-id"
      }
```

| Variable | Needed for |
|----------|------------|
| `CREDDA_API_KEY` | The platform tools: score reads, monitors, usage. |
| `CREDDA_USER_ID` | Additionally required by `mint_my_trust_token` / `present_my_credential` / `present_my_delivery_receipts`; the default subject for `request_confirmation`. |
| `CREDDA_API_BASE` | Optional override of `https://api.credda.io` (e.g. a staging deployment). |

## Tools

Public, no key, driven entirely by a token or credential a counterparty hands you:

| Tool | What it does |
|------|--------------|
| `check_trust` | Resolve a share token to the subject's score, band and a signed credential. |
| `get_trust_export` | The full portable bundle: score, history, signed W3C VC, revocation pointer. |
| `check_delivery_receipts` | A subject's delivery record (deliveries recorded, how many a distinct counterparty confirmed, failures, disputes, on-time rate) plus a signed credential of it. |
| `verify_trust_credential` | Offline-verify a compact EdDSA JWT credential presented to you. |
| `verify_verifiable_credential` | Offline-verify a W3C VC-JWT, resolving `did:web:api.credda.io` and checking revocation. |
| `list_webhook_event_types` | The public catalog of outbound webhook event types. |

With `CREDDA_API_KEY`:

| Tool | What it does |
|------|--------------|
| `get_user_score` | Latest computed score for one of your platform's users, by external id. |
| `explain_user_score` | The same score broken into its factors, in plain language. |
| `create_score_monitor` / `list_score_monitors` / `delete_score_monitor` | Edge-triggered monitors that push a `monitor.triggered` webhook instead of you polling. |
| `get_my_usage` | Your own key's usage and quota. |
| `mint_my_trust_token` / `present_my_credential` / `present_my_delivery_receipts` | Your side of a handshake: mint a share token for your own identity and hand over the credential. Also needs `CREDDA_USER_ID`. |
| `request_confirmation` | Propose an outcome and get a one-time link the named counterparty uses to confirm it. Creates a PENDING ask only: nothing reaches the ledger until they confirm, and no tool here can confirm for them. |
| `list_confirmation_requests` | The asks your key has created, with `resultingEventId` showing which ones actually produced ledger evidence. |

## Resources

| Resource | URI |
|----------|-----|
| `trust_registry` | `credda-trust://registry`, Credda's issuer entry and any federated issuers it recognizes. |
| `issuer_did_document` | `credda-trust://did`, the `did:web` document behind every signature. |

## How a score is produced

Credda's score is a deterministic function of an append-only ledger of counterparty-confirmed
events. No human and no AI sets or adjusts it, and the formula is published at
[`GET /api/v1/scoring/model`](https://api.credda.io/api/v1/scoring/model). Minting a token or
reading a score through this server changes nothing.

## License

MIT © Credda. See [LICENSE](LICENSE).

---

Part of the Credda SDK family:
[`@credda/js`](https://github.com/Credda-io/credda-js) ·
[`credda-go`](https://github.com/Credda-io/credda-go) ·
[`@credda/cli`](https://github.com/Credda-io/credda-cli) ·
[`@credda/mcp-server`](https://github.com/Credda-io/credda-mcp)
