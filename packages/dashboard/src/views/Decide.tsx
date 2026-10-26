import React from 'react';
import { t } from '../copy';
import { runDecideWindow } from '../link';
import * as s from '../dashboard.css';

type DecideState = 'waiting' | 'working' | 'needs-link' | 'failed' | 'no-opener';

/**
 * The small window the Storybook panel decides through (`/report/?decide=1`, link.ts): one
 * decision from its opener, posted with this window's dashboard link, then it closes. It stays open
 * only to say what to do: open the dashboard link first, or why the decision was not recorded.
 */
export function Decide() {
  const [state, setState] = React.useState<{ state: DecideState; detail?: string }>({ state: 'waiting' });
  React.useEffect(() => {
    document.title = t('app.decide.title');
    return runDecideWindow((next, detail) => setState({ state: next, detail }));
  }, []);
  const text = {
    waiting: t('app.decide.waiting'),
    working: t('app.decide.working'),
    'needs-link': t('app.decide.needsLink'),
    failed: t('app.decide.failed', { error: state.detail ?? '' }),
    'no-opener': t('app.decide.noOpener'),
  }[state.state];
  return (
    <div className={s.page}>
      <div className={s.empty} role="status">
        {text}
      </div>
    </div>
  );
}
