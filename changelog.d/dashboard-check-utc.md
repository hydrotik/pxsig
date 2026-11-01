### Behaviour changes

- **`pxsig dashboard check` renders every screen in UTC and `en-US`.** Its clock was already fixed;
  the time zone and locale were the machine's, so a screen showing a time read differently on a
  laptop and in CI. Now a time reads the same everywhere.
  To update: nothing to do; on a machine outside UTC, screenshots that show a time differ once
  from an earlier `--compare` run.
