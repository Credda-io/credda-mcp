# Changelog

## 1.0.0

**BREAKING. This package now does something else. Read this before upgrading.**

`@credda/mcp-server` 0.1.x and 0.2.x were an MCP server for a Credda that no
longer exists: a "verifiable, bias-free trust layer" whose tools resolved a
counterparty's share token to a 0-100 reliability score, verified and minted
W3C credentials, managed score monitors, and requested confirmations. Credda
pivoted. That product is retired, and the API those tools called is not part of
what Credda ships now.

1.0.0 is a different server under the same npm name. Nothing is deprecated
gently and nothing is aliased, because a tool that answers the wrong question
is worse than a tool that is gone:

- **Every 0.x tool is removed.** `check_trust`, `get_trust_export`,
  `check_delivery_receipts`, `verify_trust_credential`,
  `verify_verifiable_credential`, `list_webhook_event_types`, `get_user_score`,
  `explain_user_score`, `create_score_monitor`, `list_score_monitors`,
  `delete_score_monitor`, `get_my_usage`, `mint_my_trust_token`,
  `present_my_credential`, `present_my_delivery_receipts`,
  `request_confirmation`, `list_confirmation_requests`. Both MCP resources
  (`credda-trust://registry`, `credda-trust://did`) are removed too.
- **Every environment variable changed.** `CREDDA_USER_ID` is gone.
  `CREDDA_API_KEY` is now a bearer key for your own Credda API deployment, not
  a platform key for `api.credda.io`. `CREDDA_API_BASE` now points at that
  deployment and defaults to `http://127.0.0.1:4317`.
- **The registry listing moved.** The MCP Registry server name changed from
  `io.github.Credda-io/credda-trust` to `io.github.Credda-io/credda`, so
  `serverInfo` reports `credda`. The old listing is a separate entry and should
  be withdrawn rather than left pointing at this package.

**If you were using 0.2.0, pin it** (`npm install @credda/mcp-server@0.2.0`).
It will keep working exactly as long as the API behind it does, which is not a
promise this repository can make.

### What 1.0.0 is

A read-only MCP server over the Credda engine's API. It answers what Credda
found in a repository: investigations and their timelines and evidence,
resolution records (reproduction, root cause, fix, verification, and the gaps
each run did not close), and validation runs with their checks and findings.

It cannot start an investigation, spend a model budget, or open a pull request.
That is enforced, not asserted: see `src/writeSurface.test.ts`.

## 0.2.0 and earlier

The trust-layer server. See the git history for its changelog.
