### Changed

- **A person's decision is not marked with the server's assistant.** A `pxsig serve` started under
  an assistant marker no longer writes `agent` on decisions made through the dashboard link
  (`via: dashboard`, and the undo an un-approve writes) or sent by the CLI (`via: cli`).
  Decisions an assistant sends over MCP still carry it.
