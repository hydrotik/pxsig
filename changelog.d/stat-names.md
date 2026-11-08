### Fixed

- **Screen readers: a figure tile's name keeps the figure and its unit apart.** The dashboard's
  figure tiles with a unit (the Overview's latest check and its React card, Coverage, History and
  Performance) read their figure and unit as one word, "Findings 1new · of 1" or
  "Compiled 5of 9 analysed": the two were drawn apart by a margin only. Every `StatGroup` value
  that a unit follows now ends in a space that is read but not drawn ("Findings 1 new · of 1"), on
  every UI adapter, a project's own included. Nothing on screen moves.
