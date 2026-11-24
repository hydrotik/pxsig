### Behaviour changes

- **UI contract 1.9.0: every dashboard chart has an accessible name and a text summary.** `Chart`
  takes two new optional props: `label`, the chart's accessible name (its card's title), and
  `summary`, its data in one line of text from the same data as the chart. A line chart gives each
  series' range ("Changed entries per run, 14 runs: 3 to 12.", the value alone when it is flat), a
  bar chart each bar's value ("Time per compare: CLI process 3 ms, Server request 120 ms."), and a
  chart with no numbers says so ("Engine time per run: no data."). The dashboard passes both to
  every chart (Overview, Runs, Diagnostics), with the words in its copy. In the hydrotik adapter
  (the bundled dashboard) each chart stays one tab stop whose arrow keys move the tooltip, and
  that tab stop is now named by `label` and described by the summary, text with the `hidden` attribute (read once, as the description), so no
  screen moves; it was an unnamed `role="application"`. The fallback table, which the plain
  adapter and examples/custom-ui use, is named by `label` and described by `summary`.
  To update: an adapter written for 1.8.0 or earlier keeps building, with its charts unnamed. To adopt 1.9.0,
  give the chart's one tab stop (on recharts 3, the SVG of its keyboard layer, which recharts
  names from `aria-label` and `aria-describedby` passed to the chart) the name `label` and the
  description `summary` as text with the `hidden` attribute (tied by `aria-describedby`), with nothing else in it focusable or unnamed; a
  chart that is not interactive is no tab stop. Set `"contract": "1.9.0"` in conformance.json and
  rebuild ([build-adapter.md, "Chart"](../docs/ui/build-adapter.md#chart)).
