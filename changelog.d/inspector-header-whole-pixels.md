### Fixed

- **The inspector's header sits on whole pixels.** On the reference adapter its title and
  description took the dialog's line-height ratios at pxsig's sizes (17.5px and 15.75px), so the
  header was 94.25px tall and everything below it, the stage and the side panel, sat on a quarter
  pixel, with the review buttons centred on 41.625px. They are now 18px and 16px: the header is
  95px and the buttons sit on a whole pixel.
- **The Overview's Changed Entries per Run chart is 85px tall, a whole pixel.** It was a third of
  the Runs page's 16rem, 85.33px, which the chart's axes then laid out on a fraction of a pixel.
