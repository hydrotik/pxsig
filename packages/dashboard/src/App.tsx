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
import type { InspectTarget } from './inspector/Inspector';
import { Accessibility, Help, History, Inspector, Stories } from './lazy';
import { Overview } from './views/Overview';
import { Diagnostics, diagnosticsOf } from './views/Diagnostics';
import { type DiagnosticsFocus, focusOfHash } from './diagnostics-focus';
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
    <output className={s.muted}>{t('app.check.running', { count: running.length })}</output>
  ) : null;
}

/** Storybook panel: the inspector for one story (all its modes), no chrome. */
function Embed({ data, story }: { data: Data; story: string }) {
  const rows = (data.check?.rows ?? []).filter((r) => r.story === story && !r.skipped);
  const pick = rows.find((r) => !r.pass) ?? rows[0];
  const [target, setTarget] = React.useState<InspectTarget | null>(
    pick ? { row: pick, scenario: null, list: rows } : null
  );
  // Another story or fresh data: the inspector starts again on its pick.
  const [shownFor, setShownFor] = React.useState({ story, data });
  if (shownFor.story !== story || shownFor.data !== data) {
    setShownFor({ story, data });
    setTarget(pick ? { row: pick, scenario: null, list: rows } : null);
  }
  // Its own page (an iframe in the panel): one main region and a level-one heading, read but not drawn.
  return (
    <main>
      <PageTitle data={data} />
      <h1 className={s.srOnly}>
        {t('app.mark')}
        {story ? t('app.titleLabel', { label: story }) : null}
      </h1>
      {target ? (
        <React.Suspense fallback={null}>
          <Inspector
            data={data}
            target={target}
            onNavigate={setTarget}
            onClose={() => {}}
            embedded
          />
        </React.Suspense>
      ) : (
        <div className={s.empty}>{t('app.embedEmpty')}</div>
      )}
    </main>
  );
}

/**
 * The browser tab names the application under review (`pxsig • <scope>`). It sets the page's one
 * `<title>` (index.html's, which shows while the data loads): a React `<title>` would add a second.
 */
function PageTitle({ data }: { data: Data }) {
  const scope = data.scope ?? data.label ?? data.project ?? null;
  React.useEffect(() => {
    if (scope) document.title = t('app.title', { scope });
  }, [scope]);
  return null;
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
  if (error && !data) return <Placeholder text={t('app.loadError', { error })} />;
  if (!data) return <Placeholder text={t('app.loading')} />;
  const params = new URLSearchParams(location.search);
  if (params.get('embed')) return <Embed data={data} story={params.get('story') ?? ''} />;
  return <Dashboard data={data} live={live} />;
}

/** The full page, once the data is in: the bar, the section and the inspector over it. */
function Dashboard({ data, live }: { data: Data; live: ReturnType<typeof useData>['live'] }) {
  // The hash as the page opened: the tab effect rewrites it.
  const [h] = React.useState(readHash);
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
  const scope = data.scope ?? data.label ?? data.project ?? null;
  const [filter, setFilter] = React.useState('all');
  // Coverage opened on one component (a heatmap tile, an error row). It holds for that one visit:
  // Coverage opened later from the bar starts unfiltered.
  const [coverageFocus, setCoverageFocus] = React.useState<CoverageFocus | null>(null);
  const shownFocus = tab === 'integrity' ? coverageFocus : null;
  if (coverageFocus && tab !== 'integrity') setCoverageFocus(null);
  // A link to Diagnostics on a project without research data lands on the overview.
  if (tab === 'diagnostics' && !diagnosticsOf(data).length) setTab('overview');
  const [target, setTarget] = React.useState<InspectTarget | null>(null);
  // Diagnostics opened on a part: an old link (#react, #react-renders, #calibration…) names it.
  const [reactFocus, setReactFocus] = React.useState<DiagnosticsFocus | null>(() =>
    focusOfHash(readHash().get('tab'))
  );

  React.useEffect(() => {
    try {
      localStorage.setItem('pxsig-tab', tab);
    } catch {
      /* convenience only */
    }
    if (!target) history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  }, [tab, target]);
  // The section links are plain `#<id>` links: follow them (and Back/Forward) through the hash.
  // A section chosen in the bar: its heading takes focus (below), so a screen reader announces it
  // and Tab goes on in the section. Not on load, a deep link or Back / Forward.
  const chosen = React.useRef<Tab | null>(null);
  const headingFocus = React.useRef(false);
  React.useEffect(() => {
    const onHash = () => {
      const v = readHash().get('tab');
      const next = asTab(v);
      // An old link entered on an open page names its part too, as on a load.
      const focus = focusOfHash(v);
      // Chosen in the bar (or its More menu), not Back / Forward: the heading takes focus.
      headingFocus.current = !!next && chosen.current === next;
      chosen.current = null;
      // In a transition: a section loaded on first use replaces the one on screen once it is in.
      if (next)
        React.startTransition(() => {
          if (focus) setReactFocus(focus);
          setTab(next);
        });
    };
    // A section link in the bar, clicked or entered: the hashchange it causes follows.
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (a?.closest('nav, [role="menu"]'))
        chosen.current = asTab(a.getAttribute('href')!.slice(1));
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  // A new section starts at its top: <main> is the scroll container.
  const mainRef = React.useRef<HTMLElement>(null);
  const firstTab = React.useRef(true);
  // The chosen section's heading takes focus after the frame: a menu that closed hands focus back
  // to its button first.
  React.useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    mainRef.current?.scrollTo({ top: 0 });
    if (!headingFocus.current) return;
    headingFocus.current = false;
    const id = requestAnimationFrame(() => document.getElementById('section-title')?.focus());
    return () => cancelAnimationFrame(id);
  }, [tab]);

  // #inspect=<id> deep link (PR comments link here): once, when the check is in.
  const [deepLinked, setDeepLinked] = React.useState(false);
  if (!deepLinked && data.check) {
    setDeepLinked(true);
    const linked = deepLinkOf(data, h);
    if (linked) setTarget(linked);
  }
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
  const [seen, setSeen] = React.useState(data);
  if (seen !== data) {
    setSeen(data);
    const rows = data.check?.rows;
    if (rows)
      setTarget((t) => {
        if (!t || t.scenario) return t;
        const fresh = rows.find((r) => r.id === t.row.id);
        if (!fresh || fresh === t.row) return t;
        return { ...t, row: fresh, list: t.list.map((r) => rows.find((x) => x.id === r.id) ?? r) };
      });
  }

  // Stable (they only set state), so the memoised page does not render when the inspector moves.
  // Diagnostics › React on a part (the strip, the Overview's React card).
  const openReact = React.useCallback(
    (part: 'compiler' | 'renders', all?: boolean, fn?: string) => (
      setReactFocus({ section: 'react', part, all, fn, at: Date.now() }),
      setTab('diagnostics')
    ),
    []
  );
  const open = React.useCallback(
    (row: Row, list: Row[], scenario?: InspectTarget['scenario']) =>
      setTarget({ row, list, scenario: scenario ?? null }),
    []
  );
  // `f`: the Review filter, or for Coverage the component to open.
  const go = React.useCallback(
    (to: string, f?: string) => {
      // The inspector's React section: Diagnostics › React on a function.
      if (to === 'react') return openReact('compiler', true, f);
      // One transition: the section and its focus or filter change together (lazy.ts).
      React.startTransition(() => {
        if (to === 'integrity') setCoverageFocus(f ? { component: f, at: Date.now() } : null);
        else if (f) setFilter(f);
        setTab(to as Tab);
      });
    },
    [openReact]
  );
  // The session summary's next steps: leave the inspector for a tab.
  const leaveFor = React.useCallback(
    (to: string, f?: string) => (setTarget(null), go(to, f)),
    [go]
  );

  return (
    <>
      <PageTitle data={data} />
      <Page
        {...{ data, live, scope, tab, filter, setFilter, reactFocus, mainRef }}
        {...{ go, open, openReact, setTarget }}
        coverageFocus={shownFocus}
      />
      {target ? (
        // No loading state: the inspector shows once its code is in (the first time it opens).
        <React.Suspense fallback={null}>
          <Inspector
            data={data}
            target={target}
            onNavigate={setTarget}
            onClose={() => (setTarget(null), history.replaceState(null, '', `#${tab}`))}
            onGo={leaveFor}
          />
        </React.Suspense>
      ) : null}
    </>
  );
}

/** The inspector a `#inspect=<id>` link opens, with `&session=<queue>` on that review session. */
function deepLinkOf(data: Data, h: URLSearchParams): InspectTarget | null {
  const rows = data.check?.rows ?? [];
  const id = h.get('inspect');
  const row = id && rows.find((r) => r.id === id);
  if (!row) return null;
  // A reload during a review session: the session again, on its first undecided entry.
  const kind = h.get('session') as Queue | null;
  const list = kind && ['changed', 'new', 'a11y'].includes(kind) ? reviewQueue(data, kind) : null;
  if (kind && list?.length) {
    const first = list.find((r) => !decisionOf(data, kind, r.id)) ?? list[0];
    return { row: first, list, scenario: null, session: kind };
  }
  return { row, scenario: null, list: rows.filter((r) => !r.skipped) };
}

/**
 * The bar and the section on screen. Memoised: an inspector move (the target) renders the
 * inspector only, not the page behind it.
 */
const Page = React.memo(function Page({
  data,
  live,
  scope,
  tab,
  filter,
  setFilter,
  coverageFocus,
  reactFocus,
  mainRef,
  go,
  open,
  openReact,
  setTarget,
}: {
  data: Data;
  live: ReturnType<typeof useData>['live'];
  scope: string | null;
  tab: Tab;
  filter: string;
  setFilter: (f: string) => void;
  coverageFocus: CoverageFocus | null;
  reactFocus: DiagnosticsFocus | null;
  mainRef: React.RefObject<HTMLElement | null>;
  go: (t: string, f?: string) => void;
  open: (row: Row, list: Row[], scenario?: InspectTarget['scenario']) => void;
  openReact: (part: 'compiler' | 'renders', all?: boolean, fn?: string) => void;
  setTarget: (t: InspectTarget) => void;
}) {
  const todo = rowsWithPending(data).filter((r) =>
    ['changed', 'new'].includes(statusOf(r, data.review))
  ).length;
  const integrityErrors = data.integrity?.summary.componentsBySeverity.error ?? 0;
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
          {/* Sections loaded on first use (lazy.ts): the change of section is a transition, so the
              one on screen stays until the next is in; a first load shows the bar meanwhile. The
              heading is inside too: it names the section once the section is there. */}
          <React.Suspense fallback={null}>
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
          </React.Suspense>
        </div>
      </AppMain>
    </AppShell>
  );
});
