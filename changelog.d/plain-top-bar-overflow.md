### Fixed

- **The plain adapter's top bar stays on one line.** Its section links wrapped onto a second line
  when the bar was narrow (with several projects at 1280 px, and at 900 px), which breaks region
  rule R1, so `pxsig dashboard check` failed on it. The links that do not fit now move, the last
  first, into a More menu at the end of the bar; Help (`keep`) stays in the bar at every width. The
  menu is a menu button: Enter, Space or the arrow keys open it, the arrow keys, Home and End move
  through it, and Escape closes it and returns focus to the button. Its `TopNav` is now `full` in
  its conformance, and `pxsig dashboard check` passes on it with no known breaks. The same change is
  in `examples/custom-ui`.
