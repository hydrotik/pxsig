import { CONTRACT_VERSION } from '@ui';
import { t } from './copy';
import type { Data } from './data';

/**
 * "pxsig 0.5.1 · engine 0.5.1 · UI contract 1.1.0": the versions the server reports, for the top
 * bar's tooltip and the Help section. Unknown parts are left out; the contract falls back to the
 * one this page was built against.
 */
export function versionsText(data: Data): string {
  const v = data.versions;
  const contract = v.contract ?? CONTRACT_VERSION;
  return [
    v.pxsig ? t('app.versions.pxsig', { version: v.pxsig }) : null,
    v.engine ? t('app.versions.engine', { version: v.engine }) : null,
    t('app.versions.contract', { version: contract }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A commit as the page shows it: its first 7 characters. */
const short = (sha: string) => sha.slice(0, 7);

/**
 * "build 1a2b3c4 modified 9f8e7d6 · design system 5d6e7f8 · adapter hydrotik · built 2026-11-18 17:18
 * UTC": which build of the dashboard this page is (`data.build`), so two builds of one version are
 * told apart. A release build names no commit; the pxsig version it was built for is named when it
 * is not the server's. Null when the build records nothing.
 */
export function buildText(data: Data): string | null {
  const b = data.build;
  if (!b || (!b.pxsig && !b.commit)) return null;
  // A modified build names its changes' fingerprint too: two modified builds of one commit differ.
  const head = !b.commit
    ? t('app.build.release')
    : !b.dirty
      ? t('app.build.commit', { commit: short(b.commit) })
      : b.changes
        ? t('app.build.modifiedChanges', { commit: short(b.commit), changes: short(b.changes) })
        : t('app.build.modified', { commit: short(b.commit) });
  const version =
    b.pxsig && b.pxsig !== data.versions.pxsig
      ? t('app.build.version', { version: b.pxsig })
      : null;
  const ds = b.designSystem;
  // ISO 8601 in UTC: the date and the minute, the same in every time zone.
  const at = b.builtAt ? `${b.builtAt.slice(0, 10)} ${b.builtAt.slice(11, 16)}` : null;
  return [
    version ? `${head} ${version}` : head,
    ds
      ? t(ds.dirty ? 'app.build.designSystemModified' : 'app.build.designSystem', {
          commit: short(ds.commit),
        })
      : null,
    b.adapter ? t('app.build.adapter', { name: b.adapter }) : null,
    at ? t('app.build.builtAt', { date: at }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The top bar's tooltip: the versions, then the build. */
export function identityText(data: Data): string {
  const build = buildText(data);
  return build ? `${versionsText(data)} · ${build}` : versionsText(data);
}
