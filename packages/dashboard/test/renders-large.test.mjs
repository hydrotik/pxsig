/**
 * Large stores: the demo project at PXSIG_RENDERS_LARGE entries (a comma list, e.g. `1000,5000`),
 * measured per step: the Overview's mount, the Review list, a search typed into it, opening the
 * inspector and the next entry (J). Each step prints its time to the last commit, the main
 * thread's busy time (Chromium's TaskDuration), its longest task and its React renders
 * (renders-harness.mjs). A measurement, not a gate: skipped unless the
 * variable is set. PXSIG_FLOWS_ADAPTER runs it on another adapter.
 */
import { test } from 'node:test';
import { setupFlows, skip, open } from './flows-helpers.mjs';
import { EVENTS, HOOK, measure, measureMount } from './renders-harness.mjs';
import { demo } from './renders-demo.mjs';

setupFlows();

const sizes = (process.env.PXSIG_RENDERS_LARGE ?? '')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const approving = { allowed: true, folder: 'demo', command: 'pxsig serve --link' };

for (const n of sizes.length ? sizes : [0])
  test(`a store of ${n} entries, per step`, async (t) => {
    if (!n) return t.skip('PXSIG_RENDERS_LARGE is not set');
    if (skip) return t.skip(skip);
    const { page, errors } = await open(demo(n), {
      approving,
      events: EVENTS,
      images: true,
      init: HOOK,
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const busy = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')
        .value;
    /** A step with the main thread's busy time added (ms, including the settle wait's idle polls). */
    const timed = async (/** @type {() => Promise<unknown>} */ step) => {
      const before = await busy();
      const s = await measure(page, step);
      return { ...s, busy: Math.round(((await busy()) - before) * 1000) };
    };
    try {
      const steps = {};
      steps.overview = { ...(await measureMount(page)), busy: Math.round((await busy()) * 1000) };
      steps.review = await timed(() =>
        page.evaluate(() => {
          location.hash = 'stories';
        })
      );
      steps.search = await timed(() =>
        page.getByRole('searchbox').first().pressSequentially('ui-p', { delay: 30 })
      );
      steps.clear = await timed(() => page.getByRole('searchbox').first().fill(''));
      steps.open = await timed(async () => {
        await page.locator('button[data-status="changed"]').first().click();
        await page.getByRole('dialog').waitFor();
      });
      steps.next = await timed(() => page.keyboard.press('j'));
      for (const [name, s] of Object.entries(steps))
        t.diagnostic(
          `${n} ${name}: ${s.ms} ms to the last commit, busy ${s.busy} ms, longest task ${s.longest} ms, ` +
            `${s.commits} commits, ${s.rendered} rendered, ${s.mounted} mounted`
        );
      if (errors.length) throw new Error(errors.join('\n'));
    } finally {
      await page.close();
    }
  });
