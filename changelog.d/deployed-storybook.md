### Behaviour changes

- **The Storybook panel connects only on a Storybook served from this computer.** On any other
  address (a Storybook deployed to dev, UAT or pre-prod) it no longer polls `127.0.0.1:6070` on
  each viewer's computer, which could never connect there and could make the browser ask about
  local network access; it shows the read-only snapshot below, or says there is none. A
  `pxsig-server` key in `localStorage` still forces the live panel.
- **`storybook build` with the addon writes `pxsig-snapshot.json` into the build** and takes a
  few seconds longer. Option `snapshot: false` leaves it out. It never fails a build.

### Added

- **`pxsig snapshot`**: a read-only summary of the committed store for a deployed Storybook: each
  entry's baseline, last change (date, pull request, commit, colour or shape, reason), render
  environment and accepted axe rules, and each story's history. It reads the store and git only,
  and never carries who approved, how, file paths or images. In a shallow clone it shows no pull
  request rather than a wrong one.
- **A deployed Storybook's panel shows that snapshot** for the current story, matched to the
  commit the Storybook was built from.

### Documentation

- **`docs/team.md`: how pxsig works across a team.** What is shared and what stays on each
  machine, the workflow from check to merge, where pxsig runs in each environment, and why.
