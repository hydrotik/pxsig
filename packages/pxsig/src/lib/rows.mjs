/**
 * rows.mjs — one check row per manifest entry, shared by check.mjs (full runs)
 * and serve.mjs (on-demand re-checks from the dashboard, the addon and watch
 * mode), so every producer writes the same shape into <store>/reports/check.json.
 */

/** Merge the Rust verdict, the render (error, timing, axe) and the a11y baseline. */
export function buildRow(e, rust, render, a11yBase, manifest, js) {
  const r = rust ?? {};
  const rr = render ?? {};
  const violations = rr.a11y?.violations ?? null;
  const known = a11yBase?.[e.id] ?? (a11yBase ? [] : null);
  const a11y = rr.a11y ? { ...rr.a11y, new: violations && known ? violations.filter((v) => !known.includes(v.id)).length : 0, baseline: known } : null;
  // No signature yet (a story added since the last approval): rendered fine, nothing to compare
  // with. Not an error — a NEW entry waiting for a person to approve its first render.
  const isNew = !rr.error && /^no baseline sig/.test(String(r.error ?? ''));
  return {
    // A render that failed leaves the previous image on disk; its comparison describes a story
    // that did not render this time, so a render error carries no metrics and is not "changed".
    ...(rr.error ? {} : r),
    id: e.id,
    story: e.story ?? e.id,
    mode: e.mode ?? manifest.defaultMode,
    state: e.state ?? null,
    browser: e.browser ?? 'chromium',
    // The mode's Storybook globals, so the dashboard can open the story as it was rendered.
    ...(e.globals ? { globals: e.globals } : {}),
    pass: rr.error ? false : r.pass === true || r.flaky === true,
    // An error (the render's, or the engine's: an identical render across many entries) is not a change.
    changed: !rr.error && (isNew || !r.error) && r.pass !== true && !r.flaky,
    error: rr.error ?? (isNew ? null : r.error ?? null),
    ...(isNew ? { new: true, reasons: ['new: no baseline yet — approve its first render'], note: 'new' } : {}),
    renderMs: Math.round(rr.ms ?? 0),
    // When this verdict was made. Rows carried forward keep theirs, so a report can
    // mix ages: pxsig_stale compares it with source edits.
    checkedAt: new Date().toISOString(),
    a11y,
    ...(js ? { js } : {}),
  };
}

export function summarize(rows, extra = {}) {
  const checked = rows.filter((r) => !r.skipped);
  return {
    entries: rows.length,
    checked: checked.length,
    skipped: rows.length - checked.length,
    passed: checked.filter((r) => r.pass && !r.flaky).length,
    failed: checked.filter((r) => !r.pass).length,
    flaky: checked.filter((r) => r.flaky).length,
    new: checked.filter((r) => r.new).length,
    errors: checked.filter((r) => r.error).length,
    cached: checked.filter((r) => r.cached).length,
    a11yViolations: checked.reduce((a, r) => a + (r.a11y?.violations?.length ?? 0), 0),
    a11yNew: checked.reduce((a, r) => a + (r.a11y?.new ?? 0), 0),
    modes: [...new Set(checked.map((r) => r.mode))],
    ...extra,
  };
}

/**
 * Drops the rows whose entry is no longer in the manifest: a story removed (or renamed) on another
 * branch would otherwise linger in check.json as a stale "new" or failing row that nothing can
 * re-check or approve. An empty manifest drops nothing (it means "not loaded", not "no stories").
 * Returns the ids dropped; `check.rows` and `check.summary` are updated in place.
 */
export function dropStaleRows(check, manifest) {
  const known = new Set((manifest?.stories ?? []).map((e) => e.id));
  if (!known.size || !Array.isArray(check?.rows)) return [];
  const dropped = check.rows.filter((r) => !known.has(r.id)).map((r) => r.id);
  if (dropped.length) {
    check.rows = check.rows.filter((r) => known.has(r.id));
    check.summary = { ...check.summary, ...summarize(check.rows) };
  }
  return dropped;
}

/**
 * Whether renders that hit Storybook's error page mean Storybook itself is broken (a setup error:
 * nothing is recorded) rather than a few stories failing (recorded as render errors). Three or
 * more, and at least half the renders: one or two failing stories are their own errors, so a
 * story checked alone that throws is recorded, not dropped as a setup error.
 */
export const storybookBroken = (errors, total) => errors >= Math.max(3, total / 2);
