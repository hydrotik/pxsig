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
- **Decisions through the server need its token.** Approve, reject, unreview and the
  accessibility decisions need one of the random tokens the server makes when it starts: one is in
  the dashboard page a browser loads, another in a file only your user can read
  (`node_modules/.cache/pxsig/serve-<port>.token`; on Windows in the user's own
  `%LOCALAPPDATA%\pxsig\`, with no permission change), which `pxsig approve apply` reads after its
  person-at-a-terminal check. An agent or a script posting to the server is refused. The token
  used, not the request, sets `via` in the approval log. A third file token lets the MCP server
  reject entries and clear rejections, nothing else. This is a
  guard, not authentication: a process running as you can read that file, as it could edit the
  baselines directly. Checks and repairs need no token.
- **Requests from another site are refused, and so are hosts that are not loopback.** A POST whose
  `Sec-Fetch-Site` is not `same-origin` is treated like a foreign `Origin`, and a request whose
  `Host` is not 127.0.0.1, localhost or [::1] is refused (DNS rebinding).
- **Requests without an `Origin` header can check and repair.** Any process on the same machine
  can start checks, as it could run them directly.
- **Approvals need a person.** Bulk approval and `check --full --update` are refused when output is
  piped, in CI, or under a known agent, and ask for a typed phrase. The MCP review tool cannot
  approve or accept at all, and refuses even a rejection without `confirm: true`. Every
  approval is logged with hashes and can be undone. The approval log is not signed.
- **The renderer loads your Storybook** in a real browser. Treat the stories you render like any
  code you run.

## Baselines

`.psig` files are not encrypted. The header reserves an `encryption` field, but encryption is not
implemented. Anyone who can read the repository can read the baseline images.
