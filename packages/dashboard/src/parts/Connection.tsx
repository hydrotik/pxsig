import { Badge, Icon, Tooltip } from '@ui';
import { t } from '../copy';
import { served } from '../data';
import { useApproving } from '../link';
import * as s from '../dashboard.css';
import * as b from '../styles/top-bar.css';

/**
 * The connection and what this page may do, side by side in the top bar: `Live · Read only` or
 * `Live · Can approve` (served), `Static report · Read only`, or `Offline` alone. The hint repeats
 * what the inspector says under its header, with the command to copy. `lastCheck`: the time of the
 * last check while the bar has no room to show it, said in the connection's hint and name.
 * Compact (a narrow bar, styles/top-bar.css.ts), it is a dot in its tone, all of it in its name.
 */
export function Connection({ live, lastCheck }: { live: boolean; lastCheck: string | null }) {
  const approving = useApproving();
  const on = served && live;
  const connection = !served
    ? t('app.connection.static')
    : live
      ? t('app.connection.live')
      : t('app.connection.offline');
  const may = !served
    ? t('app.connection.readOnly')
    : live && approving
      ? approving.allowed
        ? t('app.connection.canApprove')
        : t('app.connection.readOnly')
      : null;
  const said = lastCheck
    ? t('app.connection.withLastCheck', { connection, date: lastCheck })
    : null;
  const tone = on ? 'success' : 'neutral';
  const emphasis = served ? undefined : 'outline';
  const first = (
    <Badge tone={tone} pulse={on} emphasis={emphasis}>
      {connection}
      {said ? <span className={s.srOnly}>{said.slice(connection.length)}</span> : null}
    </Badge>
  );
  const whole = [said ?? connection, ...(may ? [may] : [])].join(' · ');
  return (
    <span className={b.item}>
      <span className={s.pair} data-top-bar="connection-full">
        {said ? (
          <Tooltip content={said}>
            <span className={s.pair}>{first}</span>
          </Tooltip>
        ) : (
          first
        )}
        {!served ? <Badge emphasis="outline">{may}</Badge> : null}
        {on && approving ? (
          <Tooltip
            content={
              approving.allowed
                ? t('app.connection.canApproveHint')
                : t('app.connection.readOnlyHint', {
                    folder: approving.folder,
                    command: approving.command,
                  })
            }
          >
            {/* A flex box, not a block: a block's line box (the inherited line height) would make
                it taller than the badge, and the top bar would centre it on a half pixel. */}
            <span className={s.pair}>
              <Badge
                tone={approving.allowed ? 'success' : 'neutral'}
                emphasis={approving.allowed ? 'subtle' : 'outline'}
              >
                {may}
              </Badge>
            </span>
          </Tooltip>
        ) : null}
      </span>
      <span
        className={b.glyph}
        data-top-bar="connection-compact"
        data-tone={tone}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the adapter's glyph (an svg or a character) named by its words, not an image file
        role="img"
        aria-label={whole}
        title={whole}
      >
        <Icon name="dot" />
      </span>
    </span>
  );
}
