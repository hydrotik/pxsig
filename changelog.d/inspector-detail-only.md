### Behaviour changes

- **A detail-only change opens on its detail tiles.** When the detail channel alone failed an entry
  (every reason is `detail …`) and no pixel differs by more than the inspector's tolerance, the
  inspector no longer opens on an empty pixel analysis ("No changes", "No pixel differs by more
  than 16."). It draws the detail tiles whatever the saved Detail tiles switch says, steps through
  them with N, ⇧N and the change arrows as it does through pixel regions, lands on the first one,
  and Pixel Changes says why: "8 detail tiles changed below the pixel tolerance of 16.", listing
  each tile. The Detail tiles switch still hides them for that entry without changing the saved
  setting. A tolerance low enough for pixels to count as changed, a signature-gate failure and
  every other entry keep the pixel analysis, as before.
  To update: nothing to do; the change is in what the dashboard shows.
