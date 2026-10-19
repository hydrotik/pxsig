import React from 'react';
import { AppHeader, AppHeaderTitle, AppHeaderToolbar, AppShell, AppShellContent, Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from '@hydrotik/design-system';
import { useTheme } from '@hydrotik/theme-provider';
import { type Data, type Queue, type Row, reviewQueue, rowsWithPending, served, statusOf, switchProject, useData, useProjects } from './data';
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

// Tab ids are stable (deep links and the remembered tab use them); the labels come from the copy.
const TABS = ['overview', 'stories', 'integrity', 'a11y', 'history', 'diagnostics', 'help'] as const;
type Tab = (typeof TABS)[number];
/** Tabs folded into Diagnostics: old links still land there. */
const MOVED: Record<string, Tab> = { scenarios: 'diagnostics', calibration: 'diagnostics', performance: 'diagnostics' };
const asTab = (v: string | null): Tab | null => (v && TABS.includes(v as Tab) ? (v as Tab) : v && MOVED[v] ? MOVED[v] : null);

const readHash = () => new URLSearchParams(location.hash.slice(1).includes('=') ? location.hash.slice(1) : `tab=${location.hash.slice(1)}`);

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button size="sm" variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? t('app.theme.toLight') : t('app.theme.toDark')}
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
  const queues = { changed: reviewQueue(data, 'changed'), new: reviewQueue(data, 'new') };
  const startReview = (kind: Queue) => {
    const list = queues[kind];
    const first = list.find((r) => !data.review[r.id]) ?? list[0];
    if (first) setTarget({ row: first, list, scenario: null, session: kind });
  };
  const nextQueue: Queue | null = queues.changed.some((r) => !data.review[r.id]) ? 'changed' : queues.new.some((r) => !data.review[r.id]) ? 'new' : null;
  const undecided = (kind: Queue) => queues[kind].filter((r) => !data.review[r.id]).length;
  const sm = data.check?.summary;
  // Diagnostics appears only when a research run wrote its data.
  const diagnostics = diagnosticsOf(data).length > 0;
  const shown = tab === 'diagnostics' && !diagnostics ? 'overview' : tab;
  return (
    <TooltipProvider>
      <AppShell>
        <AppHeader status={!sm ? undefined : todo ? 'review-required' : 'approved'}>
          <AppHeaderTitle tag={sm ? sm.modes.join(' · ') : undefined}>{data.project ? t('app.title', { project: data.project }) : 'pxsig'}</AppHeaderTitle>
          <AppHeaderToolbar>
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
            <span className={s.micro}>{data.check ? t('app.lastCheck', { date: new Date(data.check.generatedAt).toLocaleString() }) : ''}</span>
            <ThemeToggle />
          </AppHeaderToolbar>
        </AppHeader>
        <AppShellContent asChild>
          <main>
            <div className={s.page}>
              <IntegrityBanner data={data} go={go} />
              <Tabs value={shown} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList aria-label={t('app.sections')}>
                  <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
                  <TabsTrigger value="stories">{todo ? t('tabs.reviewCount', { count: todo }) : t('tabs.review')}</TabsTrigger>
                  <TabsTrigger value="integrity">{integrityErrors ? t('tabs.coverageCount', { count: integrityErrors }) : t('tabs.coverage')}</TabsTrigger>
                  <TabsTrigger value="a11y">{t('tabs.a11y')}</TabsTrigger>
                  <TabsTrigger value="history">{t('tabs.runs')}</TabsTrigger>
                  {diagnostics ? <TabsTrigger value="diagnostics">{t('tabs.diagnostics')}</TabsTrigger> : null}
                  <TabsTrigger value="help">{t('tabs.help')}</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <Overview data={data} go={go} startReview={startReview} />
                </TabsContent>
                <TabsContent value="stories">
                  <Stories data={data} filter={filter} setFilter={setFilter} onOpen={(r, l) => open(r, l)} startReview={startReview} />
                </TabsContent>
                <TabsContent value="integrity">
                  <Integrity data={data} onOpen={(r, l) => open(r, l)} />
                </TabsContent>
                <TabsContent value="a11y">
                  <Accessibility data={data} onOpen={(r, l) => open(r, l)} />
                </TabsContent>
                <TabsContent value="history">
                  <History data={data} />
                </TabsContent>
                <TabsContent value="diagnostics">
                  <Diagnostics data={data} onOpen={open} />
                </TabsContent>
                <TabsContent value="help">
                  <Help data={data} />
                </TabsContent>
              </Tabs>
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
