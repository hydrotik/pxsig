### Fixed

- **The inspector's Files links keep their external-link icon when the panel is narrow.** A file's
  label too long for the side panel was clipped together with its icon, so the icon was cut off or
  hidden and read off its label's capitals (`dashboard check --strict` reported it with wider
  system fonts, as on macOS). Now only the label is cut short, with an ellipsis and its full text
  as a tooltip.
