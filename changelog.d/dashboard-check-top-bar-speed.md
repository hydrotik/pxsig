### Fixed

- **`pxsig dashboard check` sweeps the top bar's scenarios side by side.** The top-bar sweep (four
  scenarios over 15 widths each) ran one scenario after another and took about 60 s of a check of
  the 156 screens. Each scenario now sweeps on its own page at the same time; the findings and their
  order are the same. The plain example adapter's strict check went from about 115 s to about 58 s.
