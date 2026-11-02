/**
 * Loaded before every test file (`--import`, package.json `test` and `test:coverage`): the suite
 * runs the same whatever the contributor's shell sets. Every PXSIG_* user setting is dropped, except
 * the ones that only say where the engine, the browser and the test mode are, and PXSIG_URL points
 * at a port nothing listens on, so no test (in process or spawned) can reach a pxsig server the
 * person is running. A test that needs a value passes its own.
 */
const KEEP = new Set(['PXSIG_BIN', 'PXSIG_PLAYWRIGHT', 'PXSIG_CHROMIUM', 'PXSIG_TEST_STRICT']);
for (const name of Object.keys(process.env))
  if (name.toUpperCase().startsWith('PXSIG_') && !KEEP.has(name.toUpperCase()))
    delete process.env[name];
process.env.PXSIG_URL = 'http://127.0.0.1:1';
