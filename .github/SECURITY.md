# Security

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository: the
Security tab, then "Report a vulnerability". That opens a private advisory
visible to the maintainers and to you, and nowhere else.

Please do not open a public issue for something exploitable, and please do not
wait for us to be ready before you tell us.

What helps, in rough order:

- what an attacker gets, stated first
- the smallest input that demonstrates it
- the version or commit you were on

If you would rather not use GitHub, [credda.io](https://credda.io) has the
contact details.

## What this package is, and therefore what its attack surface is

An MCP server is driven by a model, and this server is what fills that model's
context with issue bodies, logs, diffs and check output out of a real
repository. That one sentence is the whole threat model.

- **The surface is reads only, and it is enforced rather than promised.**
  `src/apiClient.ts` has exactly one HTTP method and the verb is a literal
  `'GET'`. `src/writeSurface.test.ts` invokes every advertised tool through a
  real MCP client and fails if any request that comes out is not a GET. The API
  does have a write route, `POST /api/investigations`; it is deliberately not
  exposed here. A version that exposes it fails that test, and the README
  section that says this has to change with it.
- **Everything these tools return is attacker-influenced.** It is data. The tool
  descriptions say so to the model, and that is a mitigation rather than a
  guarantee — nothing here filters or sanitises it, and a claim that it did
  would be worse than the disclaimer. A prompt-injection payload arriving in an
  issue body and reaching a model is expected behaviour of the design, not a
  vulnerability in this package. **What a payload manages to make *this server*
  do is.**
- **It holds a credential.** `CREDDA_API_KEY` goes in a request header. If you
  find it in a URL, a log line, an error message or a tool result, that is a
  vulnerability and it is the one to report first.

The interesting reports, then, are the ones where the boundary leaks: a tool
result that escapes its framing, an argument that reaches the request path
unencoded, a response that makes the server issue a request the caller did not
ask for.

## Supported versions

The latest published minor. Fixes go to `main` and to a new release rather than
to a branch. **0.1.x and 0.2.x are a different product** — a trust-layer server,
retired with the product it spoke to — and receive no fixes.
