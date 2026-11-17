### Behaviour changes

- **`pxsig serve` and the `dashboard check` server send text gzipped.** The dashboard's script
  (3.1 MB, 650 KB gzipped), its pages, the reports' text files and the JSON answers are now sent
  with `Content-Encoding: gzip` when the request's `Accept-Encoding` allows it, and every text
  response says `Vary: Accept-Encoding`. Bodies under 1 KiB, images, fonts and the event stream
  (`/__pxsig/events`) are sent as before. A file is compressed once per change (kept by path and
  modification time, 32 MiB at most); answers built per request are never kept. Lighthouse's
  desktop run on the dashboard went from a performance score of 0.69–0.82 (LCP 2.9–3.0 s, the
  uncompressed script at its simulated 10 Mbps) to 0.98–0.99. The bundle itself is unchanged and
  still unminified.
  To update: nothing to do; browsers and `fetch` decode gzip themselves. A client that sends
  `Accept-Encoding: gzip` and reads the raw bytes must now decode them.
