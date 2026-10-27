import { CONTRACT_VERSION } from './ui/contract';
import { t } from './copy';
import type { Data } from './data';

/**
 * "pxsig 0.5.1 · engine 0.5.1 · UI contract 1.1.0": the versions the server reports, for the top
 * bar's tooltip and the Help section. Unknown parts are left out; the contract falls back to the
 * one this page was built against.
 */
export function versionsText(data: Data): string {
  const v = data.versions;
  const contract = v?.contract ?? CONTRACT_VERSION;
  return [
    v?.pxsig ? t('app.versions.pxsig', { version: v.pxsig }) : null,
    v?.engine ? t('app.versions.engine', { version: v.engine }) : null,
    t('app.versions.contract', { version: contract }),
  ]
    .filter(Boolean)
    .join(' · ');
}
