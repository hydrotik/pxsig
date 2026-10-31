import { Badge, Tooltip } from '@ui';
import { t } from '../copy';
import { served } from '../data';
import { useApproving } from '../link';
import * as s from '../dashboard.css';

/** `cd <folder> && <command>`: what a person runs for a new dashboard link. */
export const linkCommandLine = (a: { cwd: string; command: string }) =>
  `cd ${JSON.stringify(a.cwd)} && ${a.command}`;

/**
 * The connection and what this page may do, side by side in the top bar: `Live · Read only` or
 * `Live · Can approve` (served), `Static report · Read only`, or `Offline` alone. The hint repeats
 * what the inspector says under its header, with the command to copy.
 */
export function Connection({ live }: { live: boolean }) {
  const approving = useApproving();
  if (!served)
    return (
      <span className={s.pair}>
        <Badge emphasis="outline">{t('app.connection.static')}</Badge>
        <Badge emphasis="outline">{t('app.connection.readOnly')}</Badge>
      </span>
    );
  return (
    <span className={s.pair}>
      <Badge tone={live ? 'success' : 'neutral'} pulse={live}>
        {live ? t('app.connection.live') : t('app.connection.offline')}
      </Badge>
      {live && approving ? (
        <Tooltip
          content={
            approving.allowed
              ? t('app.connection.canApproveHint')
              : t('app.connection.readOnlyHint', { command: linkCommandLine(approving) })
          }
        >
          <span>
            <Badge
              tone={approving.allowed ? 'success' : 'neutral'}
              emphasis={approving.allowed ? 'subtle' : 'outline'}
            >
              {approving.allowed ? t('app.connection.canApprove') : t('app.connection.readOnly')}
            </Badge>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
