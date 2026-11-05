### Changed

- **A decision no longer makes every open dashboard fetch all of its data again.** The server's
  `review` event now carries what the decision changed (the entry's decision, and when check.json
  was rewritten, its row and the recounted summary), and the dashboard applies it in place. Other
  events still fetch the data, one fetch at a time with at most one waiting, so a burst of events
  costs two fetches instead of one each. In a large store this saves a multi-megabyte request per
  open page per decision ([docs/server.md](../docs/server.md)).
