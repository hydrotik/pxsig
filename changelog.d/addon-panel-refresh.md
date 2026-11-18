### Fixed

- **The Storybook panel fetches the status once per burst of server events.** The server sends
  hello, data, review and integrity together; each one refetched `/__pxsig/status` and cleared and
  refilled the sidebar statuses (5 fetches and 5 status-store writes when the panel connected; now
  1 and 1). An answer that changes nothing no longer re-renders the panel or touches the sidebar.
- **Check story and Check all say when a check did not start.** A server error or no answer used to
  leave the panel unchanged; the panel now shows a line such as "Check not started: the pxsig server
  answered 500."
- **The panel's status line and "Checking…" are live regions,** so a screen reader reads them when
  they change. The panel draws its own background, so its text keeps its contrast in any host, and
  "Open dashboard" opens the dashboard with `noopener`.
