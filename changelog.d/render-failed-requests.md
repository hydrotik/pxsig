### Behaviour changes

- **A render whose Storybook page did not come up names the requests that failed.** A row's error
  such as `storybook-error: the Storybook preview did not start` now ends with the requests the
  page could not load, e.g. `(request failed: /assets/iframe-….js net::ERR_NO_BUFFER_SPACE)`, so a
  module that never loaded is told apart from a preview that was only slow. Nothing else about the
  render or its verdict changes.
  To update: nothing to do; a reader matching the error text should match its start.
