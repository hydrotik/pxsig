### Fixed

- **`pxsig dashboard check`: a screen that clicks a control enabled late no longer scrolls only
  sometimes.** Playwright retries a click on a control that is not enabled yet, and its later
  attempts scroll the control into view; in a dialog that clips its overflow, one of them moved the
  whole dialog up, depending on how soon the control was enabled (the inspector's Reject waits for
  the entry's images). A `click` action now waits for its target to be enabled and the layout to
  hold still, then clicks without a retry. Screens rendered as before match their baselines.
