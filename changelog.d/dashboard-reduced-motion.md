### Fixed

- **The dashboard's own transitions stop under reduced motion.** With `prefers-reduced-motion:
  reduce`, `--pxsig-motion-fast` is now 0s, so the story card's hover icon and the Help page's
  drawing change at once instead of fading over 120ms. The adapter's components keep their own
  handling.
