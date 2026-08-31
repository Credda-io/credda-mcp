<!--
One invariant here is not negotiable and it is easier to say before review.

THE SURFACE IS READS ONLY. `src/apiClient.ts` has one HTTP method and the verb
is a literal 'GET'. `src/writeSurface.test.ts` drives every advertised tool
through a real MCP client and fails if any request that comes out is not a GET,
and it greps the source for a non-GET method literal besides. A pull request that
adds a write tool — including `POST /api/investigations`, which exists on the API
and is left off this server on purpose — fails that test, and the README section
explaining the refusal would have to change with it. That is a product decision,
not an oversight, so open an issue before writing the code.

This repository is also a source mirror: canonical engine development happens
elsewhere. What lands here is what is genuinely about this server — a tool that
mis-shapes its arguments, a paging bug, a result that loses an error's cause, a
description that misleads the model reading it.

There is one maintainer. Review is not fast; if a change matters to you, say in
the description what breaks without it.
-->

**What is wrong today.** <!-- The behaviour, not the change. -->

**What this changes.**

**How you know it works.** <!-- Name the test. `npm run typecheck && npm test`. -->

- [ ] `npm run typecheck` and `npm test` pass, `writeSurface.test.ts` included.
- [ ] This adds no write tool and no non-GET request.
- [ ] If a tool was added, renamed or removed, its description says what the returned text is and that it is untrusted data.
- [ ] Comments added here explain *why*, not *what*.
