# Continuous integration

In CI, pxsig prints Markdown (`CI` is set), refuses commands that need a person (exit 3), and
exits 1 when something changed.

    pxsig check --full                 # every entry; exit 1 on a changed, new or failed entry
    pxsig check --full --since origin/main    # only the entries the branch can change
    pxsig doctor --ci                  # fail on error-severity integrity codes only
    pxsig approve verify --all-suites --since origin/main   # every baseline went through an approval; the log only grew

`--since` selects from what changed: the entries whose baselines or store records changed, and
the story files the changed modules reach. When it is unsure (a path outside `srcRoot`, a file
nothing imports, no merge base), it checks every entry and says which path made it; list paths
that never change a render in `affects.ignore`. `pxsig affected --since origin/main` shows the
classes before a run.

`check --full` writes `<store>/reports/check.json`, `summary.md` (for a pull-request comment;
`--link-base <url>` links each entry to a published dashboard) and `junit.xml`. `pxsig report
--out <dir>` writes a static dashboard to publish as an artifact.

Warn mode lets a gate report without failing: set `enforcement.gates.<gate>` to `warn` in
pxsig.config.json (never by a CI variable; `PXSIG_ENFORCEMENT=enforce` can only raise one). The
run exits 0 where only that gate failed and says what would have failed. `--sarif <file>` on
`check --full` writes new axe violations for code-scanning viewers.

Baselines are approved by a person before they are committed; CI never writes them. Who must
review a baseline change is the code host's rule: see docs/codeowners.md.

See docs/ci.md, docs/required-checks.md, docs/local-ci.md.
