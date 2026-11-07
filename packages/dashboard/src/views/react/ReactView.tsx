/**
 * Diagnostics › React: the React Compiler's alerts (Compiler) and React's render counts (Renders),
 * one tab at a time. Alerts only: nothing here fails a check or asks for a decision.
 */
import React from 'react';
import type { Data, ReactData, Row } from '../../data';
import { Compiler } from './Compiler';
import { Renders } from './Renders';
import { OffNote, PartChoice, type ReactPart } from './shared';
import { Toolbar, ToolbarStart } from '@ui';
import * as s from '../../dashboard.css';

export type { ReactPart };

export function ReactView({
  data,
  react,
  initialPart = 'compiler',
  initialAll,
  initialFn,
  onOpen,
}: {
  data: Data;
  react: ReactData;
  initialPart?: ReactPart;
  /** Opened on every row (true) or on the alerts (false); unset: alerts when there are any. */
  initialAll?: boolean;
  /** The function whose details open first (the inspector's Open in React). */
  initialFn?: string;
  onOpen: (row: Row, list: Row[]) => void;
}) {
  const [part, setPart] = React.useState<ReactPart>(initialPart);
  // Everything React off: both tabs say so, and where.
  if (react.status.off?.key === 'react')
    return (
      <div className={s.stack}>
        <Toolbar size="sm">
          <ToolbarStart>
            <PartChoice part={part} onPart={setPart} />
          </ToolbarStart>
        </Toolbar>
        <OffNote react={react} whole />
      </div>
    );
  const props = { data, react, part, onPart: setPart, onOpen, initialAll };
  return part === 'renders' ? (
    <Renders {...props} />
  ) : (
    <Compiler {...props} initialFn={initialFn} />
  );
}
