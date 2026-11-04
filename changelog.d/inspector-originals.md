### Added

- **An Originals switch in the inspector shows the baseline and the latest render without
  analysis.** While it is on, the highlight, region outlines and detail tiles are not drawn; the
  Highlight, Regions and Detail tiles switches and the Tolerance slider show disabled and keep
  their own settings, which come back when Originals goes off. Turning it on in Pixel diff or
  Signature cells goes to Side by side, and choosing either of those turns it off. An entry opens
  fitted to the whole image instead of zoomed to its largest change. `O` toggles it, in the dialog
  and in the Storybook panel (where it sits in the side panel's View section). It is view state
  only: not saved between sessions and never sent with a decision. The images are the stored
  renders, trimmed to the story; Help says so.

### Changed

- **The inspector's Tolerance slider moves from the toolbar to the side panel's Pixel Changes
  section**, beside the counts it decides, so the toolbar with the Originals switch stays on one
  row. In the Storybook panel it moves from the View section to Pixel Changes as well. It still
  shows only when the images' pixels can be read, and is disabled while Originals is on.
  To update: nothing to do for the dashboard's users; a browser script that finds the slider by
  its name ("Tolerance") still finds it, while one that looks for it inside the toolbar or the View
  section looks in the side panel's Pixel Changes section instead.
