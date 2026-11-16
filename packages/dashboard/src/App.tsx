import React from 'react';
import { Alert, AlertDescription, AlertTitle, AppMain, AppShell, Button } from '@ui';
import {
  type Data,
  type Queue,
  type Row,
  decisionOf,
  dismissCheckError,
  reviewQueue,
  rowsWithPending,
  statusOf,
  useCheckActivity,
  useData,
} from './data';
import { Inspector, type InspectTarget } from './inspector/Inspector';
import { Overview } from './views/Overview';
import { Stories } from './views/Stories';
import { Accessibility } from './views/Accessibility';
import { Diagnostics, diagnosticsOf } from './views/Diagnostics';
import { Help } from './views/Help';
import { History } from './views/History';
import { type CoverageFocus, Integrity, IntegrityBanner } from './views/Integrity';
import { t, type CopyKey } from './copy';
import { type Section, TopBar } from './parts/TopBar';
import { ReactStrip } from './parts/ReactStrip';
import * as s from './dashboard.css';

// Section ids are stable (deep links and the remembered section use them); the labels come from the copy.
const TABS = [
  'overview',
  'stories',
  'integrity',
  'a11y',
  'history',
  'diagnostics',
  'help',
] as const;
type Tab = (typeof TABS)[number];
/** Sections folded into Diagnostics: old links still land there. */
const MOVED: Record<string, Tab> = {
  scenarios: 'diagnostics',
  calibration: 'diagnostics',
  performance: 'diagnostics',
  react: 'diagnostics',
  'react-renders': 'diagnostics',
};
const asTab = (v: string | null): Tab | null =>
  v && TABS.includes(v as Tab) ? (v as Tab) : v && MOVED[v] ? MOVED[v] : null;

const readHash = () =>
  new URLSearchParams(
    location.hash.slice(1).includes('=') ? location.hash.slice(1) : `tab=${location.hash.slice(1)}`
  );

/**
 * A check the server is running, and the error of one that failed (Storybook down, a broken
 * index): the server broadcasts both, and a failed run recorded nothing, so the page says so.
 */
function CheckBanner() {
  const { running, renders, error } = useCheckActivity();
  if (error)
    return (
      <Alert tone="danger" label={t('app.check.failedTitle')}>
        <AlertTitle>{t(error.setup ? 'app.check.setupTitle' : 'app.check.failedTitle')}</AlertTitle>
        <AlertDescription>
          <span className={s.row}>
            <span className={s.mono}>{error.message}</span>
            <Button size="sm" emphasis="outline" onClick={dismissCheckError}>
              {t('app.check.dismiss')}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    );
  // A Measure renders run: the React strip says it.
  return running?.length && !renders ? (
    <span className={s.muted} role="status">
      {t('app.check.running', { count: running.length })}
    </span>
  ) : null;
}

/** Storybook panel: the inspector for one story (all its modes), no chrome. */
function Embed({ data, story }: { data: Data; story: string }) {
  const rows = (data.check?.rows ?? []).filter((r) => r.story === story && !r.skipped);
  const pick = rows.find((r) => !r.pass) ?? rows[0];
  const [target, setTarget] = React.useState<InspectTarget | null>(
    pick ? { row: pick, scenario: null, list: rows } : null
  );
  React.useEffect(
    () => setTarget(pick ? { row: pick, scenario: null, list: rows } : null),
    // `rows` and `pick` derive from `story` and `data`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story, data]
  );
  // Its own page (an iframe in the panel): one main region and a level-one heading, read but not drawn.
  return (
    <main>
      <h1 className={s.srOnly}>
        {t('app.mark')}
        {story ? t('app.titleLabel', { label: story }) : null}
      </h1>
      {target ? (
        <Inspector data={data} target={target} onNavigate={setTarget} onClose={() => {}} embedded />
      ) : (
        <div className={s.empty}>{t('app.embedEmpty')}</div>
      )}
    </main>
  );
}

/** Loading, or the report failed to load: a main region and a level-one heading, as on the full page. */
function Placeholder({ text }: { text: string }) {
  return (
    <main className={s.page}>
      <h1 className={s.srOnly}>{t('app.mark')}</h1>
      <div className={s.empty}>{text}</div>
    </main>
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
  // The application under review (`pxsig • <scope>`), in the top bar and the browser tab.
  const scope = data ? (data.scope ?? data.label ?? data.project ?? null) : null;
  React.useEffect(() => {
    if (scope) document.title = t('app.title', { scope });
  }, [scope]);
  const [filter, setFilter] = React.useState('all');
  // Coverage opened on one component (a heatmap tile, an error row).
  const [coverageFocus, setCoverageFocus] = React.useState<CoverageFocus | null>(null);
  // It holds for that one visit: Coverage opened later from the bar starts unfiltered.
  React.useEffect(() => {
    if (tab !== 'integrity') setCoverageFocus(null);
  }, [tab]);
  // A link to Diagnostics on a project without research data lands on the overview.
  React.useEffect(() => {
    if (data && tab === 'diagnostics' && !diagnosticsOf(data).length) setTab('overview');
  }, [data, tab]);
  const [target, setTarget] = React.useState<InspectTarget | null>(null);
  // Diagnostics opened on React: an old link (#react, #react-renders) names the part.
  const [reactFocus, setReactFocus] = React.useState(() => {
    const v = readHash().get('tab');
    return v === 'react' || v === 'react-renders'
      ? {
          part: v === 'react' ? ('compiler' as const) : ('renders' as const),
          all: undefined as boolean | undefined,
          fn: undefined as string | undefined,
          at: Date.now(),
        }
      : null;
  });

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
    // A reload during a review session: the session again, on its first undecided entry.
    const kind = h.get('session') as Queue | null;
    const list = kind && ['changed', 'new', 'a11y'].includes(kind) ? reviewQueue(data, kind) : null;
    if (row && kind && list?.length) {
      const first = list.find((r) => !decisionOf(data, kind, r.id)) ?? list[0];
      setTarget({ row: first, list, scenario: null, session: kind });
    } else if (row)
      setTarget({ row, scenario: null, list: data.check.rows.filter((r) => !r.skipped) });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (target && !target.scenario)
      history.replaceState(
        null,
        '',
        `${location.pathname}${location.search}#inspect=${encodeURIComponent(target.row.id)}${target.session ? `&session=${target.session}` : ''}`
      );
  }, [target]);
  // Keep an open inspector on the fresh row when live data arrives. The row is looked up for the
  // target as it is when the update applies: a decision can move the inspector on between this
  // render and the update, and the fresh copy of the entry it left must not bring it back.
  React.useEffect(() => {
    const rows = data?.check?.rows;
    if (!rows || !target || target.scenario) return;
    setTarget((t) => {
      if (!t || t.scenario) return t;
      const fresh = rows.find((r) => r.id === t.row.id);
      if (!fresh || fresh === t.row) return t;
      return { ...t, row: fresh, list: t.list.map((r) => rows.find((x) => x.id === r.id) ?? r) };
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <Placeholder text={t('app.loadError', { error })} />;
  if (!data) return <Placeholder text={t('app.loading')} />;
  if (params.get('embed')) return <Embed data={data} story={params.get('story') ?? ''} />;

  const todo = rowsWithPending(data).filter((r) =>
    ['changed', 'new'].includes(statusOf(r, data.review))
  ).length;
  const integrityErrors = data.integrity?.summary.componentsBySeverity.error ?? 0;
  // Diagnostics › React on a part (the strip, the Overview's React card).
  const openReact = (part: 'compiler' | 'renders', all?: boolean, fn?: string) => (
    setReactFocus({ part, all, fn, at: Date.now() }),
    setTab('diagnostics')
  );
  const open = (row: Row, list: Row[], scenario: InspectTarget['scenario'] = null) =>
    setTarget({ row, list, scenario });
  // `f`: the Review filter, or for Coverage the component to open.
  const go = (t: string, f?: string) => {
    // The inspector's React section: Diagnostics › React on a function.
    if (t === 'react') return openReact('compiler', true, f);
    if (t === 'integrity') setCoverageFocus(f ? { component: f, at: Date.now() } : null);
    else if (f) setFilter(f);
    setTab(t as Tab);
  };
  // A review session: the inspector on the first undecided entry of a queue, with progress.
  const queues = {
    changed: reviewQueue(data, 'changed'),
    new: reviewQueue(data, 'new'),
    a11y: reviewQueue(data, 'a11y'),
  };
  const undecided = (kind: Queue) =>
    queues[kind].filter((r) => !decisionOf(data, kind, r.id)).length;
  const startReview = (kind: Queue) => {
    const list = queues[kind];
    const first = list.find((r) => !decisionOf(data, kind, r.id)) ?? list[0];
    if (first) setTarget({ row: first, list, scenario: null, session: kind });
  };
  const nextQueue = (['changed', 'new', 'a11y'] as const).find((k) => undecided(k) > 0) ?? null;
  // Diagnostics appears only when a research run wrote its data.
  const diagnostics = diagnosticsOf(data).length > 0;
  const shown = tab === 'diagnostics' && !diagnostics ? 'overview' : tab;
  const sectionTitle = t(
    `tabs.${({ stories: 'review', integrity: 'coverage', history: 'runs' } as Record<string, string>)[shown] ?? shown}` as CopyKey
  );
  // A count after a section's label (COUNTS.md): attention when it asks for action, neutral for a plain total.
  const counted = (
    count: number,
    tone: 'info' | 'neutral',
    key: 'review' | 'coverage' | 'a11y' | 'runs'
  ) => ({
    count,
    tone,
    label: t(`tabs.counts.${key}`, { count }),
  });
  const sections: Section[] = [
    { id: 'overview', label: t('tabs.overview') },
    { id: 'stories', label: t('tabs.review'), count: counted(todo, 'info', 'review') },
    {
      id: 'integrity',
      label: t('tabs.coverage'),
      count: counted(integrityErrors, 'info', 'coverage'),
    },
    { id: 'a11y', label: t('tabs.a11y'), count: counted(undecided('a11y'), 'info', 'a11y') },
    {
      id: 'history',
      label: t('tabs.runs'),
      count: counted(data.history?.length ?? 0, 'neutral', 'runs'),
    },
    ...(diagnostics ? [{ id: 'diagnostics', label: t('tabs.diagnostics') }] : []),
    // Help stays in the bar at every width; the other links move into the More menu.
    { id: 'help', label: t('tabs.help'), keep: true },
  ];
  return (
    <>
      <AppShell>
        <TopBar
          data={data}
          live={live}
          scope={scope}
          sections={sections}
          current={shown}
          todo={todo}
          next={nextQueue ? { kind: nextQueue, count: undecided(nextQueue) } : null}
          startReview={startReview}
        />
        <AppMain ref={mainRef}>
          <div className={s.page}>
            {/* The section's heading, for the outline (the bar's link says it visibly). */}
            <h2 id="section-title" tabIndex={-1} className={s.srOnly}>
              {sectionTitle}
            </h2>
            <ReactStrip data={data} live={live} openReact={openReact} />
            <CheckBanner />
            {/* The Overview shows coverage errors in its own errors card, so the banner leaves them to it. */}
            <IntegrityBanner
              data={data}
              go={go}
              startReview={startReview}
              errorsShownElsewhere={shown === 'overview'}
            />
            {shown === 'overview' ? (
              <Overview data={data} go={go} startReview={startReview} openReact={openReact} />
            ) : null}
            {shown === 'stories' ? (
              <Stories
                data={data}
                filter={filter}
                setFilter={setFilter}
                onOpen={(r, l) => open(r, l)}
              />
            ) : null}
            {shown === 'integrity' ? (
              <Integrity data={data} focus={coverageFocus} onOpen={(r, l) => open(r, l)} />
            ) : null}
            {shown === 'a11y' ? (
              <Accessibility data={data} onOpen={(r, l) => open(r, l)} startReview={startReview} />
            ) : null}
            {shown === 'history' ? <History data={data} /> : null}
            {shown === 'diagnostics' ? (
              <Diagnostics key={reactFocus?.at} data={data} onOpen={open} focus={reactFocus} />
            ) : null}
            {shown === 'help' ? <Help data={data} /> : null}
          </div>
        </AppMain>
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
    </>
  );
}
