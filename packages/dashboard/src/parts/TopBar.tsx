/**
 * The top bar: the report's mark, the section links (Help kept in the bar), and the controls pinned
 * at the end. What shows at a width is measured (useTopBarFit.ts): the end details go first, then
 * links move into More, then the label truncates, then the end controls go compact.
 */
import React from 'react';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  NavEnd,
  NavLink,
  NavList,
  Select,
  StatusBadge,
  Tooltip,
  TopNav,
  useThemeMode,
} from '@ui';
import { type Data, type Queue, served, switchProject, useProjects } from '../data';
import { t } from '../copy';
import { identityText } from '../versions';
import { Connection } from './Connection';
import { DETAILS } from './top-bar-fit';
import { useTopBarFit } from './useTopBarFit';
import * as s from '../dashboard.css';
import * as b from '../styles/top-bar.css';

function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  const label = mode === 'dark' ? t('app.theme.toLight') : t('app.theme.toDark');
  return (
    <IconButton
      size="sm"
      emphasis="ghost"
      label={label}
      title={label}
      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
    >
      <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
    </IconButton>
  );
}

/** The project switcher: shown when the server holds more than one project. */
function ProjectPicker({ current }: { current?: string }) {
  const projects = useProjects();
  if (projects.length < 2 || !current) return null;
  return (
    <span className={b.item} data-top-bar="picker">
      <Select
        value={current}
        onValueChange={switchProject}
        size="sm"
        label={t('app.project')}
        inlineSize="var(--pxsig-picker, 14rem)"
        options={projects.map((p) => ({
          value: p.name,
          label: t('app.projectOption', { name: p.label ?? p.name, count: p.entries }),
        }))}
      />
    </span>
  );
}

/** A section link in the bar: its id, label, count, and whether it stays in the bar. */
export interface Section {
  id: string;
  label: string;
  count?: { count: number; tone: 'info' | 'neutral'; label: string };
  keep?: boolean;
}

export interface TopBarProps {
  data: Data;
  live: boolean;
  /** The application under review (`pxsig • <scope>`), or null. */
  scope: string | null;
  sections: Section[];
  /** The current section's id. */
  current: string;
  /** Entries changed or new and not yet decided: the review status. */
  todo: number;
  /** The queue the review button starts, with its undecided count (served only). */
  next: { kind: Queue; count: number } | null;
  startReview: (kind: Queue) => void;
}

export function TopBar({
  data,
  live,
  scope,
  sections,
  current,
  todo,
  next,
  startReview,
}: TopBarProps) {
  const brand = React.useRef<HTMLHeadingElement>(null);
  const sm = data.check?.summary;
  const review = served && next ? next : null;
  const beside = Boolean(review);
  const sig = sections.map((x) => `${x.label}:${x.count?.count ?? ''}`).join('|');
  const fit = useTopBarFit(brand, {
    endClass: b.navEnd,
    total: sections.length,
    kept: sections.filter((x) => x.keep).map((x) => `#${x.id}`),
    sig,
  });
  const lastCheckHidden = fit.shed > DETAILS.indexOf('last-check');
  const status = !sm
    ? undefined
    : todo
      ? ({ tone: 'warning', icon: 'alert', label: t('app.status.reviewRequired') } as const)
      : ({ tone: 'success', icon: 'check', label: t('app.status.approved') } as const);
  const lastCheck = data.check ? new Date(data.check.generatedAt).toLocaleString() : null;
  const full = review ? t(`app.startReview.${review.kind}`, { count: review.count }) : '';
  const mark = t('app.mark');
  const label = scope ? t('app.titleLabel', { label: scope }) : null;
  return (
    <TopNav
      label={t('app.sections')}
      className={b.navbar}
      brand={
        <h1 ref={brand} className={b.brand}>
          {/* The versions and the build on hover; the Help section shows them as text. */}
          <Tooltip content={identityText(data)}>
            <span>{mark}</span>
          </Tooltip>
          {label ? (
            <span className={b.scope} title={`${mark}${label}`} data-top-bar="scope">
              {label}
            </span>
          ) : null}
          <span aria-hidden="true" className={b.scopeCap} data-top-bar="scope-cap" />
          <span aria-hidden="true" className={b.scopeMin} data-top-bar="scope-min" />
          <span aria-hidden="true" className={b.gap} data-top-bar="gap" />
          <span aria-hidden="true" className={b.gapTight} data-top-bar="gap-tight" />
        </h1>
      }
    >
      <NavList moreLabel={t('app.moreSections')}>
        {sections.map((x) => (
          <NavLink
            key={x.id}
            href={`#${x.id}`}
            active={current === x.id}
            keep={x.keep}
            count={x.count?.count}
            countTone={x.count?.tone}
            countLabel={x.count?.label}
          >
            {x.label}
          </NavLink>
        ))}
      </NavList>
      {/* Pinned controls sit beside the list, so the list's own resize tracking sees them change width. */}
      <NavEnd className={b.navEnd}>
        {review ? (
          <Button size="sm" aria-label={full} onClick={() => startReview(review.kind)}>
            <span className={b.label} data-top-bar="review-full">
              {full}
            </span>
            <span className={b.label} data-top-bar="review-compact" aria-hidden="true">
              {t(`app.startReview.short.${review.kind}`, { count: review.count })}
            </span>
          </Button>
        ) : null}
        <ProjectPicker current={data.project} />
        {/* The report's modes, beside the connection: what this data covers, and how fresh it is. */}
        {sm ? (
          <span className={b.item} data-top-bar="modes">
            <Badge>{sm.modes.join(' · ')}</Badge>
          </span>
        ) : null}
        <Connection live={live} lastCheck={lastCheckHidden ? lastCheck : null} />
        {lastCheck ? (
          <span className={s.micro} data-top-bar="last-check">
            {t('app.lastCheck', { date: lastCheck })}
          </span>
        ) : null}
        <ThemeToggle />
        {status && beside ? (
          <span className={b.item} data-top-bar="status-beside">
            <StatusBadge {...status} />
          </span>
        ) : status ? (
          <span className={b.item}>
            <span className={b.item} data-top-bar="status-full">
              <StatusBadge {...status} />
            </span>
            {/* Compact: the glyph alone, in its tone's colour, the label its name. */}
            <span
              className={b.glyph}
              data-top-bar="status-compact"
              data-tone={status.tone}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the adapter's glyph (an svg or a character) named by its words, not an image file
              role="img"
              aria-label={status.label}
              title={status.label}
            >
              <Icon name={status.icon} />
            </span>
          </span>
        ) : null}
      </NavEnd>
    </TopNav>
  );
}
