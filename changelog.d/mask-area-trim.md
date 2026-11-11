### Fixed

- **A mask's share of the capture is measured on the image that is compared.** The masked pixels
  were counted on the capture before trim and divided by the trimmed image, so a mask over the
  whole component (which trim crops down to 16×16) made every mask on that entry read 100% of the
  capture and warn. The capture now also records each mask's boxes, and the area is the part of
  them inside the trimmed image, as a share of that image. Verdicts are unchanged; a baseline
  approved with the earlier area reads no "masks changed", since the new area is never larger.
