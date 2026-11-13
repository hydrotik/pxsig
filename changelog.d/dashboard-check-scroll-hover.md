### Fixed

- **`pxsig dashboard check`: a screen that clicks, then scrolls, no longer shows a hover only
  sometimes.** The click left the pointer where the scroll brought other content, and the browser
  re-hovers it on a timer of its own, so a row under the pointer was highlighted in some captures
  and not in others. After a `scroll` action that follows a `click`, the pointer moves to the
  page's corner, where nothing hovers. A screen like that shows nothing hovered from now on: its
  baseline changes once, to be approved.
