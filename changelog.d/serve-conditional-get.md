### Fixed

- **`pxsig serve` answers a revalidation with 304.** The dashboard's files (its 3 MB script among
  them) are served `no-cache` with a Last-Modified date, but a request that sent the date back was
  answered with the whole file again, so the Storybook panel downloaded the script on every story
  switch. Files now carry a weak ETag, and a request whose If-None-Match or If-Modified-Since
  matches gets 304 with no body and the same headers.
