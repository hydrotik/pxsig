import React from 'react';
import { AppShell, AppShellContent, Badge, Button, Icons, NavItemLink, NavItems, Navbar, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusBadge, TooltipProvider } from '@hydrotik/design-system';
import { useTheme } from '@hydrotik/theme-provider';
import { type Data, type Queue, type Row, decisionOf, reviewQueue, rowsWithPending, served, statusOf, switchProject, useData, useProjects } from './data';
import { Inspector, type InspectTarget } from './inspector/Inspector';
import { Overview } from './views/Overview';
import { Stories } from './views/Stories';
import { Accessibility } from './views/Accessibility';
import { Diagnostics, diagnosticsOf } from './views/Diagnostics';
import { Help } from './views/Help';
import { History } from './views/History';
import { Integrity, IntegrityBanner } from './views/Integrity';
import { t } from './copy';
import * as s from './dashboard.css';

// Section ids are stable (deep links and the remembered section use them); the labels come from the copy.
const TABS = ['overview', 'stories', 'integrity', 'a11y', 'history', 'diagnostics', 'help'] as const;
type Tab = (typeof TABS)[number];
/** Sections folded into Diagnostics: old links still land there. */
const MOVED: Record<string, Tab> = { scenarios: 'diagnostics', calibration: 'diagnostics', performance: 'diagnostics' };
const asTab = (v: string | null): Tab | null => (v && TABS.includes(v as Tab) ? (v as Tab) : v && MOVED[v] ? MOVED[v] : null);

const readHash = () => new URLSearchParams(location.hash.slice(1).includes('=') ? location.hash.slice(1) : `tab=${location.hash.slice(1)}`);

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const label = theme === 'dark' ? t('app.theme.toLight') : t('app.theme.toDark');
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Icons.Sun aria-hidden /> : <Icons.Moon aria-hidden />}
    </Button>
  );
}

/** Storybook panel: the inspector for one story (all its modes), no chrome. */
function Embed({ data, story }: { data: Data; story: string }) {
  const rows = (data.check?.rows ?? []).filter((r) => r.story === story && !r.skipped);
  const pick = rows.find((r) => !r.pass) ?? rows[0];
  const [target, setTarget] = React.useState<InspectTarget | null>(pick ? { row: pick, scenario: null, list: rows } : null);
  React.useEffect(() => setTarget(pick ? { row: pick, scenario: null, list: rows } : null), [story, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return <div className={s.empty}>{t('app.embedEmpty')}</div>;
  return <Inspector data={data} target={target} onNavigate={setTarget} onClose={() => {}} embedded />;
}

/** The project switcher: shown when the server holds more than one project. */
function ProjectPicker({ current }: { current?: string }) {
  const projects = useProjects();
  if (projects.length < 2 || !current) return null;
  return (
    <Select value={current} onValueChange={switchProject}>
      <SelectTrigger size="sm" aria-label={t('app.project')} style={{ inlineSize: '14rem' }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.name} value={p.name}>
            {t('app.projectOption', { name: p.name, count: p.entries })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function App() {
  const { data, error, live } = useData();
  const params = new URLSearchParams(location.search);
  // The hash as the page opened: the tab effect rewrites it before served data arrives.
  const h = React.useRef(readHash()).current;
  const [tab, setTab] = React.useState<Tab>(() => {
    const fromHash = asTab(h.get('tab'));
    if (fromHash) return fromHash;
    try {
      return asTab(localStorage.getItem('pxsig-tab')) ?? 'overview';
    } catch {
      return 'overview';
    }
  });
  const [filter, setFilter] = React.useState('all');
  // A link to Diagnostics on a project without research data lands on the overview.
  React.useEffect(() => {
    if (data && tab === 'diagnostics' && !diagnosticsOf(data).length) setTab('overview');
  }, [data, tab]);
  const [target, setTarget] = React.useState<InspectTarget | null>(null);

  React.useEffect(() => {
    try {
      localStorage.setItem('pxsig-tab', tab);
    } catch {
      /* convenience only */
    }
    if (!target) history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  }, [tab, target]);
  // The section links are plain `#<id>` links: follow them (and Back/Forward) through the hash.
  React.useEffect(() => {
    const onHash = () => {
      const next = asTab(readHash().get('tab'));
      if (next) setTab(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // A new section starts at its top: <main> is the scroll container.
  const mainRef = React.useRef<HTMLElement>(null);
  const firstTab = React.useRef(true);
  React.useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // #inspect=<id> deep link (PR comments link here)
  const deepLinked = React.useRef(false);
  React.useEffect(() => {
    if (!data?.check || deepLinked.current) return;
    deepLinked.current = true;
    const id = h.get('inspect');
    const row = id && data.check.rows.find((r) => r.id === id);
    if (row) setTarget({ row, scenario: null, list: data.check.rows.filter((r) => !r.skipped) });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (target && !target.scenario) history.replaceState(null, '', `${location.pathname}${location.search}#inspect=${encodeURIComponent(target.row.id)}`);
  }, [target]);
  // Keep an open inspector on the fresh row when live data arrives.
  React.useEffect(() => {
    if (!data?.check || !target || target.scenario) return;
    const fresh = data.check.rows.find((r) => r.id === target.row.id);
    if (fresh && fresh !== target.row) setTarget((t) => t && { ...t, row: fresh, list: t.list.map((r) => data.check!.rows.find((x) => x.id === r.id) ?? r) });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <div className={s.page}><div className={s.empty}>{t('app.loadError', { error })}</div></div>;
  if (!data) return <div className={s.page}><div className={s.empty}>{t('app.loading')}</div></div>;
  if (params.get('embed')) return <TooltipProvider><Embed data={data} story={params.get('story') ?? ''} /></TooltipProvider>;

  const rows = data.check?.rows ?? [];
  const todo = rowsWithPending(data).filter((r) => ['changed', 'new'].includes(statusOf(r, data.review))).length;
  const integrityErrors = data.integrity?.summary.componentsBySeverity.error ?? 0;
  const open = (row: Row, list: Row[], scenario: InspectTarget['scenario'] = null) => setTarget({ row, list, scenario });
  const go = (t: string, f?: string) => {
    if (f) setFilter(f);
    setTab(t as Tab);
  };
  // A review session: the inspector on the first undecided entry of a queue, with progress.
  const queues = { changed: reviewQueue(data, 'changed'), new: reviewQueue(data, 'new'), a11y: reviewQueue(data, 'a11y') };
  const undecided = (kind: Queue) => queues[kind].filter((r) => !decisionOf(data, kind, r.id)).length;
  const startReview = (kind: Queue) => {
    const list = queues[kind];
    const first = list.find((r) => !decisionOf(data, kind, r.id)) ?? list[0];
    if (first) setTarget({ row: first, list, scenario: null, session: kind });
  };
  const nextQueue = (['changed', 'new', 'a11y'] as const).find((k) => undecided(k) > 0) ?? null;
  const sm = data.check?.summary;
  // Diagnostics appears only when a research run wrote its data.
  const diagnostics = diagnosticsOf(data).length > 0;
  const shown = tab === 'diagnostics' && !diagnostics ? 'overview' : tab;
  const status = !sm ? undefined : todo ? 'review-required' : 'approved';
  const link = (id: Tab, label: string) => (
    <NavItemLink key={id} href={`#${id}`} active={shown === id}>
      {label}
    </NavItemLink>
  );
  return (
    <TooltipProvider>
      <AppShell>
        <Navbar
          aria-label={t('app.sections')}
          className={s.navbar}
          logo={
            <>
              <h1 className={s.brand}>{data.project ? t('app.title', { project: data.project }) : 'pxsig'}</h1>
              {sm ? <Badge variant="secondary" className={s.brandTag}>{sm.modes.join(' · ')}</Badge> : null}
            </>
          }
        >
          <NavItems>
            {link('overview', t('tabs.overview'))}
            {link('stories', todo ? t('tabs.reviewCount', { count: todo }) : t('tabs.review'))}
            {link('integrity', integrityErrors ? t('tabs.coverageCount', { count: integrityErrors }) : t('tabs.coverage'))}
            {link('a11y', t('tabs.a11y'))}
            {link('history', t('tabs.runs'))}
            {diagnostics ? link('diagnostics', t('tabs.diagnostics')) : null}
            {link('help', t('tabs.help'))}
          </NavItems>
          {/* Pinned controls sit beside the list, so the list's own resize tracking sees them change width. */}
          <div className={s.navEnd}>
            {served && nextQueue ? (
              <Button size="sm" onClick={() => startReview(nextQueue)}>
                {t(`app.startReview.${nextQueue}`, { count: undecided(nextQueue) })}
              </Button>
            ) : null}
            <ProjectPicker current={data.project} />
            {served ? (
              <Badge variant={live ? 'success' : 'secondary'} pulse={live}>
                {live ? t('app.connection.live') : t('app.connection.offline')}
              </Badge>
            ) : (
              <Badge variant="outline">{t('app.connection.static')}</Badge>
            )}
            {data.check ? <span className={[s.micro, s.lastCheck].join(' ')}>{t('app.lastCheck', { date: new Date(data.check.generatedAt).toLocaleString() })}</span> : null}
            <ThemeToggle />
            {status ? <StatusBadge status={status} className={served && nextQueue ? s.statusBeside : undefined} /> : null}
          </div>
        </Navbar>
        <AppShellContent asChild>
          <main ref={mainRef}>
            <div className={s.page}>
              <IntegrityBanner data={data} go={go} />
              {shown === 'overview' ? <Overview data={data} go={go} startReview={startReview} /> : null}
              {shown === 'stories' ? <Stories data={data} filter={filter} setFilter={setFilter} onOpen={(r, l) => open(r, l)} startReview={startReview} /> : null}
              {shown === 'integrity' ? <Integrity data={data} onOpen={(r, l) => open(r, l)} /> : null}
              {shown === 'a11y' ? <Accessibility data={data} onOpen={(r, l) => open(r, l)} startReview={startReview} /> : null}
              {shown === 'history' ? <History data={data} /> : null}
              {shown === 'diagnostics' ? <Diagnostics data={data} onOpen={open} /> : null}
              {shown === 'help' ? <Help data={data} /> : null}
            </div>
          </main>
        </AppShellContent>
      </AppShell>
      {target ? (
        <Inspector
          data={data}
          target={target}
          onNavigate={setTarget}
          onClose={() => (setTarget(null), history.replaceState(null, '', `#${tab}`))}
          onGo={(t, f) => (setTarget(null), go(t, f))}
        />
      ) : null}
    </TooltipProvider>
  );
}
