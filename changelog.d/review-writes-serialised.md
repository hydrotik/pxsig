### Fixed

- **Overlapping decisions on the same project are no longer able to lose one.** Two decisions sent
  at the same time (two dashboard tabs, or MCP and the dashboard) each read the project's
  `review.json`, waited for the capture, and wrote the file back, so the later write could drop
  the earlier decision. The server now runs each project's decisions (visual and accessibility,
  and approving a whole story) one after another; a decision that fails does not hold up the next.
