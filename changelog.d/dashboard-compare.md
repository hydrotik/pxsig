### Added

- **`pxsig dashboard check --compare <dir>`** compares each screen with the same screen of an
  earlier check's output (its `--out`), using the engine and the gates stories get. Changed, new
  and gone screens are listed in `summary.md` and `report.json` (`compare` per screen: status,
  SSIM, changed cells), and the gallery shows the earlier screenshot and the changed pixels beside
  each changed screen, with a "changed screens only" filter. Advisory: a change never fails the
  check. Use it to see what an adapter or design-system change moves.
