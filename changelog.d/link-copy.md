### Behaviour changes

- **The dashboard link has 5 minutes to be accessed, up from 2.** The time is only to open the link;
  once opened, that browser can approve until `pxsig serve` stops or the browser closes. Every
  message now says so in those words ("5 minutes to access this link").
  To update: nothing to do; a script that matched the old wording ("within two minutes") matches
  the new one.

### Added

- **`pxsig serve --link --copy`** also copies the new link to the clipboard and says so (`pbcopy` on
  macOS; `wl-copy`, else `xclip`, on Linux; not on Windows, where pxsig starts no shell). Opt-in:
  any program on the computer can read the clipboard, while the printed link reaches only the person
  at the terminal. Refused, like `--link`, without a person at a terminal.
