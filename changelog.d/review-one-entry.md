### Behaviour changes

- **One entry, one decision: Approve story is off by default.** The inspector no longer offers
  **Approve story** (every waiting mode and state of a story in one click), and the server refuses
  `POST /__pxsig/approve-story` with 403, so each entry is approved after a person has looked at it.
  To bring it back, set `approvals.byStory: true` in `pxsig.config.json`.

### Fixed

- **The inspector's Reject and Approve keep their place.** They end the review group at its right
  edge, with labels that no longer change width: Undo, Approve story (when on), Re-check and the
  new-violations note sit to their left, and the header holds one height whether or not the story
  has other modes. "Approve · accepts N new a11y violations" becomes the note "Approving accepts N
  new a11y violations" beside an unchanged Approve; in an accessibility session, "Accept N new"
  becomes "Accept violations" beside "N new violations". The Storybook panel's Details switch moves
  left of the buttons for the same reason.
