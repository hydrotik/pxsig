### Fixed

- **An old Diagnostics link entered on an open dashboard opens its part.** Changing the address
  from `#react` to `#react-renders` on an open page left React on the Compiler: only a load read
  the part from the link. Every link of a section folded into Diagnostics (`#react`,
  `#react-renders`, `#scenarios`, `#calibration`, `#performance`) now opens the part it names on a
  load and on a change alike; `#scenarios`, `#calibration` and `#performance` used to open
  Diagnostics on its first part.
