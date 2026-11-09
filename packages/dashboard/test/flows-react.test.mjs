/**
 * Diagnostics › React, the React strip and the Overview's React card in a real browser, against a
 * mocked server (flows-helpers.mjs, the shared React scenarios): the alerts first, a function's
 * side panel (focus in, Escape out), Analyse and Measure renders posted with what they need and
 * disabled while read only, Skip and Cancel from the strip, the strip's end line, and old links.
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsOf, scenarioData } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

/**
 * A connected page (the mocked stream would end, and the page go offline): an EventSource that
 * says hello, then sends the scenario's events, as `pxsig dashboard check`'s server does.
 * @param {string} name
 */
const live = (name) => ({
  content: `(() => {
    const events = ${JSON.stringify(eventsOf(name))};
    class Fake extends EventTarget {
      constructor() {
        super();
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent('hello', { data: '{}' }));
          for (const [e, d] of events) this.dispatchEvent(new MessageEvent(e, { data: JSON.stringify(d) }));
        }, 50);
      }
      close() {}
    }
    window.EventSource = Fake;
  })();`,
});
const CAN = { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' };
const CANNOT = { ...CAN, allowed: false };

test('Compiler: alerts first, every function on demand, a side panel that takes focus and gives it back', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(scenarioData('react'), { hash: '#react', approving: CAN });
  try {
    await page.getByRole('heading', { name: 'React Compiler' }).waitFor();
    const names = () => page.locator('table tbody tr td:first-child strong').allInnerTexts();
    assert.deepEqual(await names(), ['Button', 'useGrid', 'Select', 'Toast']);
    await page.getByRole('button', { name: 'All analysed (9)' }).click();
    assert.equal((await names()).length, 9);
    // A row opens its details beside the table, focus in the panel.
    await page.getByText('Button', { exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Button' });
    await panel.waitFor();
    assert.ok(
      await panel.getByText(/compiled at main, skipped now/).isVisible(),
      'the alert, verbatim'
    );
    assert.ok(await panel.getByRole('link', { name: 'refs on react.dev' }).isVisible());
    assert.ok(
      await page.evaluate(() => !!document.activeElement?.closest('[aria-labelledby], aside')),
      'focus moved into the panel'
    );
    // Escape closes it.
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('Analyse posts with the link, and is disabled while read only; no merge base shows every function', async (t) => {
  if (skip) return t.skip(skip);
  {
    const { page, posts } = await open(scenarioData('react'), { hash: '#react', approving: CAN });
    try {
      await page.getByRole('button', { name: 'Analyse', exact: true }).click();
      await page.waitForTimeout(100);
      assert.deepEqual(
        posts.map((p) => p.name),
        ['react/analyse']
      );
    } finally {
      await page.close();
    }
  }
  {
    const { page, posts } = await open(scenarioData('react'), {
      hash: '#react',
      approving: CANNOT,
    });
    try {
      const b = page.getByRole('button', { name: 'Analyse', exact: true });
      await b.waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (x) => x.textContent === 'Analyse' && x.disabled
        )
      );
      assert.match(
        String(await b.getAttribute('title')),
        /^Read only: this needs the dashboard link/
      );
      assert.deepEqual(posts, []);
    } finally {
      await page.close();
    }
  }
  {
    const { page } = await open(scenarioData('react-no-base'), { hash: '#react', approving: CAN });
    try {
      await page.getByText(/^No merge base with main/).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Alerts (0)' }).isDisabled());
      assert.equal(await page.locator('table tbody tr').count(), 9);
    } finally {
      await page.close();
    }
  }
});

test('Compiler: the title and the side panel name the compiler that ran, Babel or built in', async (t) => {
  if (skip) return t.skip(skip);
  for (const [name, title, compiler, babel] of [
    ['react', 'React Compiler (babel-plugin-react-compiler 1.0.0)', '1.0.0', true],
    [
      'react-oxc',
      'React Compiler (built-in, oxc 0.143.0, experimental)',
      'Built-in, oxc 0.143.0, experimental',
      false,
    ],
  ]) {
    const { page, errors } = await open(scenarioData(name), { hash: '#react', approving: CAN });
    try {
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.getByRole('button', { name: 'All analysed (9)' }).click();
      await page.getByText('Button', { exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Button' });
      await panel.waitFor();
      assert.ok(await panel.getByText(compiler, { exact: true }).isVisible(), name);
      assert.equal(await panel.getByText('Babel', { exact: true }).count(), babel ? 1 : 0, name);
      assert.equal(await page.getByText(/not installed/i).count(), 0, name);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test('Renders: Measure renders posts a visual check with counting on for the scope; Cancel stops it', async (t) => {
  if (skip) return t.skip(skip);
  {
    const { page, posts } = await open(scenarioData('react'), {
      hash: '#react-renders',
      approving: CAN,
    });
    try {
      await page.getByRole('heading', { name: 'Renders per Entry' }).waitFor();
      assert.equal(await page.locator('table tbody tr').count(), 1, 'the alert only');
      await page.getByRole('button', { name: 'Measure renders' }).click();
      await page.waitForTimeout(100);
      assert.equal(posts[0].name, 'check');
      assert.equal(posts[0].body.renders, true);
      assert.equal(posts[0].body.ids.length, 7, 'every entry (the default scope)');
    } finally {
      await page.close();
    }
  }
  {
    const { page, posts } = await open(scenarioData('react-measuring'), {
      hash: '#react-renders',
      approving: CAN,
      init: live('react-measuring'),
    });
    try {
      await page.getByText('Measuring 3 of 7 entries…').waitFor();
      // The strip says it: no "Checking 1 entry…" line.
      assert.equal(await page.getByText(/^Checking \d+ entr/).count(), 0);
      await page.getByRole('button', { name: 'Cancel' }).first().click();
      await page.waitForTimeout(100);
      assert.deepEqual(
        posts.map((p) => p.name),
        ['check/cancel']
      );
    } finally {
      await page.close();
    }
  }
});

test('the strip: Skip while the analysis runs, its result line after, disabled while read only; Open React lands on Compiler', async (t) => {
  if (skip) return t.skip(skip);
  {
    const { page, posts } = await open(scenarioData('react-running'), {
      hash: '#overview',
      approving: CAN,
      init: live('react-running'),
    });
    try {
      const strip = page.getByRole('region', { name: 'React analysis' });
      await strip.getByText('3 of 4 files · 2 cached').waitFor();
      await strip.getByRole('button', { name: 'Skip', exact: true }).click();
      await page.waitForTimeout(100);
      assert.deepEqual(
        posts.map((p) => p.name),
        ['react/skip']
      );
    } finally {
      await page.close();
    }
  }
  {
    const { page, posts } = await open(scenarioData('react-running'), {
      hash: '#overview',
      approving: CANNOT,
      init: live('react-running'),
    });
    try {
      const skipButton = page
        .getByRole('region', { name: 'React analysis' })
        .getByRole('button', { name: 'Skip', exact: true });
      await skipButton.waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('section[aria-label="React analysis"] button')].every(
          (b) => b.disabled
        )
      );
      assert.deepEqual(posts, []);
    } finally {
      await page.close();
    }
  }
  {
    const { page } = await open(scenarioData('react-done'), {
      hash: '#overview',
      approving: CAN,
      init: live('react-done'),
    });
    try {
      // Once on the line, once in the status the page announces.
      await page
        .getByText('React: 2 newly skipped · 1 new reason · 1 new finding · 1 fixed')
        .first()
        .waitFor();
      await page.getByRole('button', { name: 'Open React' }).click();
      await page.getByRole('heading', { name: 'React Compiler' }).waitFor();
    } finally {
      await page.close();
    }
  }
});

test('the Overview card opens React where its figure is listed; old links land on the part', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open(scenarioData('react'), { hash: '#overview', approving: CAN });
  try {
    await page.getByRole('heading', { name: 'React', exact: true }).waitFor();
    // A tile's name keeps its figure and unit apart: a space read, not drawn (ui/index.ts).
    for (const [region, names] of [
      [
        'React figures',
        ['Findings 1 new · of 1', 'Compiled 5 of 9 analysed', 'Still rendering 1 of 7 entries'],
      ],
      ['Latest check', ['New a11y 0 of 0 violations']],
    ])
      for (const name of names)
        await page
          .getByRole('region', { name: region })
          .getByRole('button', { name, exact: true })
          .waitFor({ timeout: 2000 });
    await page.getByRole('button', { name: /^Still rendering/ }).click();
    await page.getByRole('heading', { name: 'Renders per Entry' }).waitFor();
  } finally {
    await page.close();
  }
  const old = await open(scenarioData('react'), { hash: '#react-renders', approving: CAN });
  try {
    await old.page.getByRole('heading', { name: 'Renders per Entry' }).waitFor();
  } finally {
    await old.page.close();
  }
  // No React data (an older server, a static report without results): no React segment.
  const none = scenarioData('clean');
  const plain = await open(none, { hash: '#react', approving: CAN });
  try {
    await plain.page.getByRole('heading', { name: 'Batch Check by Thread Count' }).waitFor();
  } finally {
    await plain.page.close();
  }
});

test("the inspector's React section: counts, the alert, and Open in React on the function", async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(scenarioData('react'), {
    hash: '#inspect=ui-button--primary',
    approving: CAN,
    images: true,
  });
  try {
    const section = page.locator('aside section', { hasText: 'Compiler alerts (1)' }).first();
    await section.waitFor();
    assert.ok(await page.getByText('No: still committing at capture').isVisible());
    assert.ok(await page.getByText('src/Button/Button.tsx · refs, line 18').isVisible());
    await page.getByRole('button', { name: 'Open in React', exact: true }).click();
    await page.getByRole('complementary', { name: 'Button' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
  // The Storybook panel shows no React section.
  const embed = await open(scenarioData('react'), {
    hash: '?embed=1&story=ui-button--primary',
    images: true,
  });
  try {
    await embed.page.getByRole('switch', { name: 'Show details', exact: true }).click();
    await embed.page.getByRole('heading', { name: 'View', exact: true }).waitFor();
    assert.equal(await embed.page.getByRole('heading', { name: 'React', exact: true }).count(), 0);
  } finally {
    await embed.page.close();
  }
});
