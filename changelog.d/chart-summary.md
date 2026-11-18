### Behaviour changes

- **UI contract 1.8.0: every dashboard chart has an accessible name and a text summary.** `Chart`
  takes two new optional props: `label`, the chart's accessible name (its card's title), and
  `summary`, its data in one line of text from the same data as the chart ("Changed entries per
  run, 14 runs: 3 to 12."). The dashboard passes both to every chart (Overview, Runs, Diagnostics),
  with the words in its copy. The hydrotik adapter (the bundled dashboard) draws each chart as one
  image named by `label` (`role="img"`) and described by the summary, visually hidden text, so no
  screen moves; its charts are no longer tab stops (recharts made the SVG a focusable
  `role="application"`, whose arrow keys only moved the tooltip). The fallback table, which the
  plain adapter and examples/custom-ui use, is named by `label` and described by `summary`.
  To update: an adapter written for 1.7.0 keeps building, with its charts unnamed. To adopt 1.8.0,
  name the chart by `label` and tie `summary` to it as visually hidden text (for example
  `role="img"` with `aria-label` and `aria-describedby`), keep the chart out of the tab order unless
  it is interactive (on recharts 3, `accessibilityLayer={false}`), set `"contract": "1.8.0"` in
  conformance.json and rebuild ([build-adapter.md, "Chart"](../docs/ui/build-adapter.md#chart)).
