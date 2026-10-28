/**
 * storybook-link.mjs — the Storybook URL for one check entry: its story, in its mode's globals
 * (theme, colorway, preset, typeface…), so an `@light` entry opens in the light theme. Plain JS so
 * the pxsig tests can import it without a build.
 *
 * Globals come from the entry (the row's `globals`, written from the manifest entry), else from the
 * report's mode table. They go in Storybook's `key:value;key:value` form, each key and value
 * URL-encoded and the separators kept. An interaction state (`__cleared`, `__open`) is driven by
 * the check and cannot be reached by URL: it is returned as `state` for the caller to note.
 *
 * @param {string} baseUrl Storybook's base URL.
 * @param {{ id: string, story?: string, mode?: string | null, state?: string | null, globals?: string | null }} row
 * @param {Record<string, { globals?: string }> | null} [modes] the report's `manifest.modes`
 * @returns {{ url: string, globals: string, state: string | null }}
 */
export function storybookLink(baseUrl, row, modes) {
  const raw = row.globals ?? (row.mode ? modes?.[row.mode]?.globals : undefined) ?? '';
  const globals = String(raw)
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      return i < 0
        ? encodeURIComponent(pair)
        : `${encodeURIComponent(pair.slice(0, i))}:${encodeURIComponent(pair.slice(i + 1))}`;
    })
    .join(';');
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const url = `${base}/?path=/story/${encodeURIComponent(row.story ?? row.id)}${globals ? `&globals=${globals}` : ''}`;
  return { url, globals, state: row.state ?? null };
}
