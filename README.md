<p align="center">
  <a href="https://credda.io">
    <img alt="Credda" width="96" height="96"
         src="https://raw.githubusercontent.com/Credda-io/credda-mcp/main/assets/credda-mark-spectrum.png">
  </a>
</p>

> Source mirror for [`@credda/mcp-server`](https://www.npmjs.com/package/@credda/mcp-server). Install from npm: `npm install -g @credda/mcp-server`. Canonical development happens in Credda internal tooling; this repo is for source and issues.

# @credda/mcp-server

> ### ⚠️ 1.0.0 is a different server under the same npm name
>
> Versions 0.1.x and 0.2.x of this package were a **trust-layer** server:
> resolve a counterparty's share token to a reliability score, verify and mint
> credentials, manage score monitors. Credda pivoted and that product is
> retired. **Every tool, resource and environment variable from 0.x is gone**,
> with no aliases and no deprecation period, because a tool that answers the
> wrong question is worse than a tool that is missing. If you depend on the old
> behaviour, pin `@credda/mcp-server@0.2.0`. The full list is in
> [CHANGELOG.md](CHANGELOG.md).

**Credda takes a bug report or a security vulnerability somebody already
filed, reproduces the failure, diagnoses the cause, writes the patch, and
proves it with a test that fails before and passes after. It does not go
looking for defects — the input is a labelled report. It proposes; it never
merges. Whether the diff becomes a pull request depends on which mechanism
delivered it: the GitHub App path opens one with no flag, for a run that reaches
`READY_FOR_REVIEW` with a proven verdict, while the GitHub Action opens none
unless the caller sets `open-pull-request`, which defaults to `false`
(`action/action.yml`).**

This package is not that engine. It is a [Model Context
Protocol](https://modelcontextprotocol.io) server that lets an agent **read what
Credda found**: investigations and their evidence, resolution records, and
validation runs with their checks and findings. It is a thin, read-only client
over [the Credda API](#which-endpoints-this-wraps) — no database, no analysis,
no engine logic.

## What it cannot do, and why that is deliberate

**It cannot start an investigation, spend a model budget, apply a patch, or open
a pull request in anybody's repository.**

That is a property of this MCP server today, not a statement about the product:
the engine can open a pull request, and on the GitHub App path it does so
without anybody opting in — the gate there is the run's state and verdict, not a
switch. What is true here is narrower and worth being exact about. An MCP server is driven by a
model, and this server is what fills that model's context with issue bodies,
logs, diffs and check output out of a real repository. A tool that spends money
or writes to a repository, reachable by a model that has just read attacker-
controlled text, is a bad trade at any level of prompt hygiene. So the surface
is reads only.

The API this wraps has two write routes — `POST /api/investigations`, which
creates a run, and `POST /api/investigations/:id/cancel`, which stops one.
**Neither is exposed here.** Starting work costs money on a customer's account
and is the first step of a chain that can end in a proposed patch, and stopping
somebody's run is a decision a person makes; an operator does both with the CLI,
deliberately, as themselves. The refusal is enforced rather than promised — `src/apiClient.ts`
has exactly one HTTP method and the verb is a literal `'GET'`, and
[`src/writeSurface.test.ts`](src/writeSurface.test.ts) invokes **every**
advertised tool through a real MCP client and fails if any request that comes
out of it is not a GET. If a later version exposes that route, that test fails
and this section has to change with it.

## Prompt injection: what is true, and what is not claimed

Everything these tools return — issue titles and bodies, evidence summaries,
log excerpts, unified diffs, check output — originates in a customer's
repository or in a report somebody filed. It is untrusted input, and it lands
verbatim in the model's context.

**Nothing in this package sanitises it, and no filtering is implemented.** Every
tool description says so, so a model reading a tool result has been told what
kind of text it is holding. The only real mitigation here is the shape of the
surface: a model talked into "now open a pull request" finds no tool that can.
Treat tool output as data. When you act on it, act with your own judgment and
your own credentials.

## Install

```json
{
  "mcpServers": {
    "credda": {
      "command": "npx",
      "args": ["-y", "@credda/mcp-server"],
      "env": {
        "CREDDA_API_BASE": "http://127.0.0.1:4317",
        "CREDDA_API_KEY": "..."
      }
    }
  }
}
```

`@credda/mcp-server` is on npm, so `npx` fetches it with no checkout and no
build.

> **What `npx -y @credda/mcp-server` gets you today — checked 2026-08-29.** Not
> this server. The latest version on npm is **0.2.0**, the retired trust-layer
> server described in the warning at the top of this file; `1.0.0`, which this
> README documents, is not published yet. The
> [MCP Registry](https://registry.modelcontextprotocol.io) is in the same state:
> the only Credda entry there is `io.github.Credda-io/credda-trust` at `0.1.3`,
> still describing share tokens and credentials. The `mcpName` in this
> repository's `package.json` is `io.github.Credda-io/credda`, which is the name
> the registry entry becomes when 1.0.0 is published — it is not resolvable
> before then. Until then, run this server from a checkout (see
> [Development](#development)) rather than from `npx`.

| Variable | Needed for |
|----------|------------|
| `CREDDA_API_BASE` | Where your Credda API runs. Defaults to `http://127.0.0.1:4317`, the loopback address a local install publishes. |
| `CREDDA_API_KEY` | A bearer key for that API. Required when it runs with `CREDDA_AUTH=enforced`; omit it for a local install with auth disabled. The key is scoped to an organisation and grants **reads across all of it**. |

## Tools

All read-only. All of them page with `limit` (1–100, API default 50) and
`offset` unless noted.

| Tool | What it returns |
|------|-----------------|
| `list_repositories` | The repositories in your organisation. Start here to get an id. |
| `get_repository` | One repository by id: name, clone source, default branch. Resolves the `repositoryId` every other row carries. |
| `list_repository_learnings` | What Credda has learned about one repository, anchored to a file or symbol, with an observation count and an ordinal weight. |
| `list_investigations` | The investigation queue: state, outcome, duration, event and evidence counts. Filter by `repository`, `signal`, `state`, `outcome`. |
| `get_investigation` | One run: the reported issue, ranked hypotheses, any patches (unified diff, files changed, rationale) and any verification runs over them. |
| `list_investigation_events` | The run's timeline, cursor-paged with `since` / `nextSince` / `hasMore`. Debug events omitted unless `includeDebug`. |
| `list_investigation_evidence` | The observations a conclusion rests on: type, phase, strength, summary, artifact pointer. |
| `list_resolutions` | Resolution records: what was reported, whether it reproduced, the verification verdict, regression status, and the confidence class **with its `notEstablished` gaps**. |
| `get_latest_resolution` | The newest record for one investigation, or `{"resolution": null}` when it has produced none. |
| `get_resolution` | The whole record: reproduction and its captured failure signature, root cause, fix, verification signals, regression protection before/after, confidence and its named gaps. |
| `list_validations` | Validation runs over a change: state, outcome, commits compared, environment status. |
| `get_validation` | One validation, its environment and change impact, and the counts of checks, findings and evidence. |
| `list_validation_checks` | The executed plan, in sequence. `baseStatus` is the load-bearing field. |
| `list_validation_findings` | Severity, confidence, expected vs observed behaviour, reproduction, affected area, likely source. Narrow with `severity` and `status`. |
| `list_validation_evidence` | The evidence behind a validation's checks, filterable by `type`. |
| `list_validation_events` | The validation's timeline, cursor-paged with `since` / `nextSince` / `hasMore`. Debug events omitted unless `includeDebug`. |
| `get_api_health` | Readiness of the API this server reads from. No arguments. |

### Reading a result honestly

Two fields carry most of the meaning and are easy to skim past:

- **`confidence.notEstablished`** on a resolution is the list of things the run
  did **not** establish. A record is never a bare verdict; the class and the
  gaps travel together and neither should be read alone.
- **`baseStatus`** on a validation check: `FAILED` there means the check was
  re-run at the base commit and passed, so *this change* caused the failure.
- A **null** `rootCause`, `fix` or `verification` means the run produced no such
  row. It is a hole that is named, never one that was filled in.

## Which endpoints this wraps

One row per route the engine serves and this server reads, and every one of them
a `GET` behind the single bearer gate mounted on `/api/*`
(`apps/api/src/auth.ts`). They are documented at
[api.credda.io/reference](https://api.credda.io/reference).

This table used to group routes by the engine file that defines them, which made
it four lines shorter and unable to notice a route the engine gained -- it went
stale on `GET /api/repositories/:id`, and it still called
`POST /api/investigations` "the one write route" after a second one shipped. It
is now one row per route and `src/routeSurface.test.ts` holds it to
`src/route-surface.json`, the route list generated in the engine's own
repository. A route missing from this table fails the suite by name.

| Route | Tool |
|-------|------|
| `GET /api/repositories` | `list_repositories` |
| `GET /api/repositories/:id` | `get_repository` |
| `GET /api/repositories/:id/learnings` | `list_repository_learnings` |
| `GET /api/investigations` | `list_investigations` |
| `GET /api/investigations/:id` | `get_investigation` |
| `GET /api/investigations/:id/events` | `list_investigation_events` |
| `GET /api/investigations/:id/evidence` | `list_investigation_evidence` |
| `GET /api/resolutions` | `list_resolutions` |
| `GET /api/resolutions/latest` | `get_latest_resolution` |
| `GET /api/resolutions/:id` | `get_resolution` |
| `GET /api/validations` | `list_validations` |
| `GET /api/validations/:id` | `get_validation` |
| `GET /api/validations/:id/checks` | `list_validation_checks` |
| `GET /api/validations/:id/findings` | `list_validation_findings` |
| `GET /api/validations/:id/evidence` | `list_validation_evidence` |
| `GET /api/validations/:id/events` | `list_validation_events` |
| `GET /api/health` | `get_api_health` |

**Not wrapped, on purpose.** This list is exhaustive against the engine's
published route surface, and the suite fails if it stops being.

- `POST /api/investigations` — a write, and the route that spends a model budget
  on your account. See
  [above](#what-it-cannot-do-and-why-that-is-deliberate).
- `POST /api/investigations/:id/cancel` — a write. It shipped in the engine on
  2026-08-29, and this list said "the one write route" until the route surface
  was wired in and said otherwise. Stopping a run is an operator's decision, and
  a tool for it would put "cancel somebody's run" one jailbroken issue body
  away; the CLI stops a run, deliberately, as a person.
- `GET /api/investigations/:id/stream` — SSE. A long-lived stream has no shape
  in a request/response tool call; poll `list_investigation_events` with `since`
  instead.
- `GET /api/validations/:id/stream` — SSE, for the same reason. Poll
  `list_validation_events` with `since`.
- `GET /api/organization` — the organisation's own name, plan and counts. It
  says nothing about what Credda found, which is the only question this server
  exists to answer, and the key already scopes every other tool to it.
- `GET /api/organization/members` — names and email addresses of your
  colleagues. A model asking what Credda found has no use for them, and putting
  personal data in a context window is not a thing to do incidentally.
- `GET /api/organization/keys` — API key metadata. No secret is retrievable
  there, and it is still not something a model needs to enumerate.
- `GET /api/metrics` — Prometheus exposition, for a scraper rather than a
  reader.
- `GET /livez` — a process liveness probe with no body. `get_api_health` answers
  the readiness question a caller actually has.
- `GET /openapi.json` — the engine's own specification. A model that can call
  the tools above does not need the document describing routes it cannot reach.

### Filter vocabularies

`signal`, `repository` and `investigation` are ids and are passed through as
given. The rest -- `state`, `outcome`, `severity`, `status`, `type`, `kind`,
`confidence` -- are closed sets, and each is advertised **in the tool's input
schema as an enum**, so a client that validates arguments rejects a wrong token
before a request is made and a model reading the tool list never has to invent
one.

They used to be typed as free strings, documented as "validated by the API,
which rejects an unknown one with a 400". That is true, and it is useless to the
only caller this server has. Nothing about the word `outcome` says that a run
which reproduced a failure without establishing its cause is
`REPRODUCED_NOT_DIAGNOSED`, or that evidence showing the repository's own test
already asserts the reported behaviour is a `SPECIFICATION`. A model guesses
`fixed`, collects the 400, and spends another turn -- each one arriving with
more untrusted repository text in its context.

The 28 investigation states are not transcribed here. They come from the
`vocabularies` block of `src/route-surface.json`, generated in the engine from
the same Zod schemas its routes parse with, and carrying its own digest
alongside the route digest. `src/routeSurface.test.ts` fails when a filter the
engine declares a vocabulary for is offered here as open text, and
`route-surface.consumers.json` in the engine fails **there**, naming this
repository, when the copy goes stale. `includeDebug` is the one declared
vocabulary deliberately not enumerated: its wire values are
`"true" | "false" | "1" | "0"` because a query string carries strings, and the
tool takes the JSON boolean that says the same thing.

## Development

```bash
npm install
npm run typecheck
npm test        # 59 tests
npm run build
npm run example # see it answer, with no key and no network
```

### A worked example you can run

[`examples/try-the-server.mjs`](examples/try-the-server.mjs) spawns the **built**
server — `node dist/index.js`, over a real stdio transport, exactly the way an
MCP client config launches it — points it at a loopback stub of the Credda API,
lists the advertised tools, calls two of them, and asserts that every request
that reached the stub was a `GET`. It needs no key, no account and no network.

It is the only check that the published binary starts: the test suites build the
server in-process from `src/`, so a `dist/index.js` that failed on boot would
leave them green. The payloads are hand-written — this shows how the server is
driven, and is not evidence about the engine.

## License

MIT © Credda. See [LICENSE](LICENSE).
