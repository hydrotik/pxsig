# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's private vulnerability reporting on
the repository: <https://github.com/hydrotik/pxsig/security/advisories/new>. Do not open a public
issue.

Include what you found, how to reproduce it, and what an attacker could do with it. We will
acknowledge the report, keep you informed, and credit you in the advisory unless you prefer not
to be named.

## Supported versions

pxsig is at 0.x. Fixes go into the latest release only.

## How pxsig is meant to run

pxsig is a developer and CI tool. It runs on your machine or your runner, against your own
Storybook.

- **The server binds to `127.0.0.1` only.** It is not reachable from other machines.
- **It refuses cross-origin writes.** A POST that carries an `Origin` header is accepted only from
  the server's own origin or from a served project's Storybook origin. A page on any other site
  cannot approve, reject or start checks. CORS headers are sent only to those Storybook origins.
- **Requests without an `Origin` header are accepted.** Any process on the same machine can call
  the API, as it could edit the files directly.
- **Approvals need a person.** Bulk approval and `check --full --update` are refused when output is
  piped, in CI, or under a known agent, and ask for a typed phrase. The MCP review tool refuses
  without `confirm: true`, which an agent may pass only on the user's explicit instruction. Every
  approval is logged with hashes and can be undone.
- **The renderer loads your Storybook** in a real browser. Treat the stories you render like any
  code you run.

## Baselines

`.psig` files are not encrypted. The header reserves an `encryption` field, but encryption is not
implemented. Anyone who can read the repository can read the baseline images.
