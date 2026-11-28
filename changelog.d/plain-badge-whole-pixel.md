### Fixed

- **The plain adapter's badges are 18px tall.** They took the inherited normal line height, 17px
  with their borders, so in the top bar (28px) the modes, the connection and "Can approve" or "Read
  only" sat on half pixels, and a badge beside an 18px icon was 0.5px off. A badge now has a 1rem
  line height of its own. The hydrotik build is unchanged.
