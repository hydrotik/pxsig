### Changed

- **The dashboard renders far less.** Opening, moving in and closing the inspector no longer
  re-render the section behind it; the inspector's parts skip the renders that do not change them;
  the Review list follows its search through a deferred value and keeps the cards still listed.
  On a 48-entry demo project with the reference adapter, the next entry (J) renders 2,454 -> 643
  components, opening the inspector 2,023 -> 707 and closing it 949 -> 1. Every dashboard
  component now compiles with the React Compiler, with no bail-out. Screens do not change.
