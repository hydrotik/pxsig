/**
 * server-lanes.test.mjs — the server's two engines (serve/create.mjs): tracing (`affected`, what
 * an integrity pass sends once per edited file) runs on its own engine, so a call on the decision
 * lane (`capture` for an approval, `compare` for a check) does not wait behind a pass's queue.
 *
 *   node --test packages/pxsig/test/server-lanes.test.mjs
 *
 * Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const skip = skipUnless(hasRust, 'Rust binary not built');
const FILE = 'src/components/Alpha/Alpha.stories.tsx';

/** The engines this process runs: its children started from the Rust binary (not on Windows). */
function engines() {
  const ps = execFileSync('ps', ['-A', '-o', 'ppid=,command='], { encoding: 'utf8' });
  return ps
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(([ppid, cmd]) => Number(ppid) === process.pid && cmd === rustBin).length;
}

test(
  'tracing answers what the engine answers, on its own lane: a ping is not queued behind 200 traces',
  { skip },
  async () => {
    const f = fixture();
    const app = createPxsigServer({
      ws: findWorkspace({ cwd: f.repo }),
      flags: {},
      port: 0,
      open: false,
    });
    try {
      await app.start();
      const { srv } = app;
      const S = [...srv.states.values()][0];
      await S.integrityDone;
      // The same ids as the decision lane's engine gives for the file.
      const run = /** @type {string} */ (S.runPath);
      const direct = await srv.rust('affected', { manifest: run, root: f.repo, files: [FILE] });
      assert.deepEqual(await S.affected(FILE), direct.traced ?? direct.ids);
      assert.ok((await S.affected(FILE)).length > 0, 'the file traces to its entries');

      /** @type {string[]} */
      const order = [];
      const traces = Array.from({ length: 200 }, (_, i) =>
        S.affected(FILE).then(() => order.push(`trace ${i}`))
      );
      const ping = srv.rust('ping', {}).then(() => order.push('ping'));
      await Promise.all([...traces, ping]);
      // On one engine the ping answers after all 200 (it answers in order); on its own, early.
      assert.ok(order.indexOf('ping') < 50, `ping answered at ${order.indexOf('ping')} of 201`);

      if (process.platform !== 'win32') assert.equal(engines(), 2, 'two engines while serving');
      app.srv.kill();
      if (process.platform !== 'win32') {
        for (let i = 0; i < 50 && engines() > 0; i++) await new Promise((r) => setTimeout(r, 20));
        assert.equal(engines(), 0, 'kill() stops both');
      }
    } finally {
      await app.stop();
    }
  }
);
