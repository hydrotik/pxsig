import React from 'react';
import { AppHeader, AppHeaderTitle, AppHeaderToolbar, AppShell, AppShellContent, Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from '@hydrotik/design-system';
import { useTheme } from '@hydrotik/theme-provider';
import { type Data, type Row, rowsWithPending, served, statusOf, switchProject, useData, useProjects } from './data';
import { Inspector, type InspectTarget } from './inspector/Inspector';
import { Overview } from './views/Overview';
import { Stories } from './views/Stories';
import { Scenarios } from './views/Scenarios';
import { Accessibility } from './views/Accessibility';
import { Calibration } from './views/Calibration';
import { Performance } from './views/Performance';
import { History } from './views/History';
import { Integrity, IntegrityBanner } from './views/Integrity';
import * as s from './dashboard.css';

const TABS = ['overview', 'stories', 'integrity', 'a11y', 'scenarios', 'calibration', 'performance', 'history'] as const;
type Tab = (typeof TABS)[number];

const readHash = () => new URLSearchParams(location.hash.slice(1).includes('=') ? location.hash.slice(1) : `tab=${location.hash.slice(1)}`);

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button size="sm" variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </Button>
  );
}

/** Storybook panel: the inspector for one story (all its modes), no chrome. */
function Embed({ data, story }: { data: Data; story: string }) {
  const rows = (data.check?.rows ?? []).filter((r) => r.story === story && !r.skipped);
  const pick = rows.find((r) => !r.pass) ?? rows[0];
  const [target, setTarget] = React.useState<InspectTarget | null>(pick ? { row: pick, scenario: null, list: rows } : null);
  React.useEffect(() => setTarget(pick ? { row: pick, scenario: null, list: rows } : null), [story, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return <div className={s.empty}>No pxsig result for {story} yet: run a check from the toolbar.</div>;
  return <Inspector data={data} target={target} onNavigate={setTarget} onClose={() => {}} embedded />;
}

/** The project switcher: shown when the server holds more than one project. */
function ProjectPicker({ current }: { current?: string }) {
  const projects = useProjects();
  if (projects.length < 2 || !current) return null;
  return (
    <Select value={current} onValueChange={switchProject}>
      <SelectTrigger size="sm" aria-label="Project" style={{ inlineSize: '14rem' }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.name} value={p.name}>
            {p.name} · {p.entries} entries
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
    const t = h.get('tab') as Tab;
    if (TABS.includes(t)) return t;
    try {
      return (localStorage.getItem('pxsig-tab') as Tab) || 'overview';
    } catch {
      return 'overview';
    }
  });
  const [filter, setFilter] = React.useState('all');
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

  if (error && !data) return <div className={s.page}><div className={s.empty}>Could not load report data: {error}</div></div>;
  if (!data) return <div className={s.page}><div className={s.empty}>Loading…</div></div>;
  if (params.get('embed')) return <TooltipProvider><Embed data={data} story={params.get('story') ?? ''} /></TooltipProvider>;

  const rows = data.check?.rows ?? [];
  const todo = rowsWithPending(data).filter((r) => ['changed', 'new'].includes(statusOf(r, data.review))).length;
  const integrityErrors = data.integrity?.summary.componentsBySeverity.error ?? 0;
  const open = (row: Row, list: Row[], scenario: InspectTarget['scenario'] = null) => setTarget({ row, list, scenario });
  const go = (t: string, f?: string) => {
    if (f) setFilter(f);
    setTab(t as Tab);
  };
  const sm = data.check?.summary;
  // Research views appear only when a research run wrote their data.
  const research = {
    scenarios: Object.keys(data.scenarioSuites ?? {}).length > 0,
    calibration: Object.keys(data.calibrationSuites ?? {}).length > 0 || !!data.detailCalibration,
    performance: !!data.bench,
  };
  return (
    <TooltipProvider>
      <AppShell>
        <AppHeader status={!sm ? undefined : todo ? 'review-required' : 'approved'}>
          <AppHeaderTitle tag={sm ? sm.modes.join(' · ') : undefined}>pxsig · {data.project ?? 'visual regression'}</AppHeaderTitle>
          <AppHeaderToolbar>
            <ProjectPicker current={data.project} />
            {served ? (
              <Badge variant={live ? 'success' : 'secondary'} pulse={live}>
                {live ? 'Live' : 'Offline'}
              </Badge>
            ) : (
              <Badge variant="outline">Static</Badge>
            )}
            <span className={s.micro}>{data.check ? `checked ${new Date(data.check.generatedAt).toLocaleString()}` : ''}</span>
            <ThemeToggle />
          </AppHeaderToolbar>
        </AppHeader>
        <AppShellContent asChild>
          <main>
            <div className={s.page}>
              <IntegrityBanner data={data} go={go} />
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList aria-label="Report sections">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="stories">Stories{todo ? ` · ${todo} to review` : ''}</TabsTrigger>
                  <TabsTrigger value="integrity">Integrity{integrityErrors ? ` · ${integrityErrors} need attention` : ''}</TabsTrigger>
                  <TabsTrigger value="a11y">Accessibility</TabsTrigger>
                  {research.scenarios ? <TabsTrigger value="scenarios">Scenarios</TabsTrigger> : null}
                  {research.calibration ? <TabsTrigger value="calibration">Calibration</TabsTrigger> : null}
                  {research.performance ? <TabsTrigger value="performance">Performance</TabsTrigger> : null}
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <Overview data={data} go={go} />
                </TabsContent>
                <TabsContent value="stories">
                  <Stories data={data} filter={filter} setFilter={setFilter} onOpen={(r, l) => open(r, l)} />
                </TabsContent>
                <TabsContent value="integrity">
                  <Integrity data={data} onOpen={(r, l) => open(r, l)} />
                </TabsContent>
                <TabsContent value="a11y">
                  <Accessibility data={data} onOpen={(r, l) => open(r, l)} />
                </TabsContent>
                <TabsContent value="scenarios">
                  <Scenarios data={data} onOpen={open} />
                </TabsContent>
                <TabsContent value="calibration">
                  <Calibration data={data} />
                </TabsContent>
                <TabsContent value="performance">
                  <Performance data={data} />
                </TabsContent>
                <TabsContent value="history">
                  <History data={data} />
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </AppShellContent>
      </AppShell>
      {target ? <Inspector data={data} target={target} onNavigate={setTarget} onClose={() => (setTarget(null), history.replaceState(null, '', `#${tab}`))} /> : null}
    </TooltipProvider>
  );
}
