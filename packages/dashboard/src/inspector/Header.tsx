/** The inspector's header (Inspector.tsx): the entry's context, id and reasons, and its actions. */
import type { ReactNode, RefObject } from 'react';
import { Button, type DialogDescription, type DialogTitle } from '@ui';
import { type Data, type Row, statusOf } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';
import { StatusOf } from '../parts/StatusOf';
import type { storybookLink } from '../storybook-link.mjs';
import type { InspectTarget } from './Inspector';

export function Header({
  data,
  row,
  target,
  embedded,
  sbLink,
  desc,
  Title,
  Desc,
  titleRef,
  siblingToggle,
  storyNav,
  reviewButtons,
  recheckButton,
  onClose,
}: {
  data: Data;
  row: Row;
  target: InspectTarget | null;
  embedded: boolean;
  sbLink: ReturnType<typeof storybookLink>;
  desc: string;
  Title: 'h2' | typeof DialogTitle;
  Desc: 'p' | typeof DialogDescription;
  titleRef: RefObject<HTMLHeadingElement | null>;
  siblingToggle: ReactNode;
  storyNav: ReactNode;
  reviewButtons: ReactNode;
  recheckButton: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className={s.insHead}>
      <div className={s.insInfo}>
        <div className={s.insContext}>
          <StatusOf status={statusOf(row, data.review)} />
          {siblingToggle}
          <span className={`${s.micro} ${s.clip}`}>
            {target!.scenario
              ? t('inspector.contextScenario', { name: target!.scenario.name })
              : `${t('inspector.contextLatest', { mode: row.mode })}${row.state ? ` · ${row.state}` : ''}${row.browser && row.browser !== 'chromium' ? ` · ${row.browser}` : ''}`}
            {sbLink.state ? (
              <span className={s.muted}>
                {' '}
                · {t('inspector.storybook.state', { state: sbLink.state })}
              </span>
            ) : null}
          </span>
        </div>
        <Title ref={titleRef} tabIndex={-1} className={s.insTitle} title={row.id}>
          {row.id}
        </Title>
        <Desc className={`${s.micro} ${s.clip}`} style={{ margin: 0 }} title={desc || undefined}>
          {desc || '\u00a0'}
        </Desc>
      </div>
      <div className={s.insActions}>
        {storyNav}
        {/* Re-check's label changes while it runs: left of the review buttons, so they stay put. */}
        {recheckButton}
        {reviewButtons}
        {embedded ? null : (
          <Button size="sm" emphasis="outline" onClick={onClose}>
            {t('inspector.close')}
          </Button>
        )}
      </div>
    </div>
  );
}
