### Fixed

- **A Markdown table cell keeps a backslash before a pipe inside the cell.** Plain (Markdown)
  output escaped a cell's pipes but not its backslashes, so a value such as `a\|b` printed as
  `a\\|b`, where the pipe ended the cell and shifted the row's columns. Backslashes are now escaped
  too, and a Windows line break becomes a space like a Unix one.

### Security

- **The container image build checks out the release tag's commit, never a name.** The image
  workflow resolved the release as the bare name `v<version>`, which a branch of the same name would
  have shadowed (release tags are protected; branches named `v*` are not). It now checks out the
  commit of the protected tag, and after a release run only if that is the commit the release built.
  No checkout keeps the job's token in its git config, so the examples run inside the image cannot
  read it.
