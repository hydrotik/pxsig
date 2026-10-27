/**
 * smoke.mjs — run inside the pxsig image by .github/workflows/image.yml (not part of the image).
 *
 *   node smoke.mjs fonts                                  print the fonts.system digest (the label)
 *   node smoke.mjs env --arch x64 --fonts <sha> --image <tag>
 *                                                         launch Chromium, Firefox and WebKit through
 *                                                         the image's pxsig and check their render
 *                                                         environment: linux, this arch, these fonts,
 *                                                         this image
 *
 * It loads the installed pxsig (/opt/pxsig/node_modules/pxsig), so it tests what the image ships.
 */
import { existsSync } from 'node:fs';

const PXSIG = '/opt/pxsig/node_modules/pxsig/src/lib';
const [cmd, ...argv] = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : null;
};
const fail = (m) => {
  console.error(`smoke: ${m}`);
  process.exit(1);
};

// pxsig before 0.5.0 records no render environment: nothing to measure or check.
if (!existsSync(`${PXSIG}/env.mjs`)) {
  console.error('smoke: this pxsig has no render environment (before 0.5.0); skipped');
  if (cmd === 'fonts') console.log('');
  process.exit(0);
}

const env = await import(`${PXSIG}/env.mjs`);
if (cmd === 'fonts') {
  console.log(env.systemFonts('linux') ?? '');
  process.exit(0);
}
if (cmd !== 'env') fail(`unknown command ${cmd}`);

const { browserPool } = await import(`${PXSIG}/capture.mjs`);
const pool = browserPool(null);
const want = { arch: opt('arch'), fonts: opt('fonts'), image: opt('image') };
try {
  for (const type of ['chromium', 'firefox', 'webkit']) {
    const e = await pool.env(type);
    const got = {
      platform: e.os.platform,
      arch: e.os.arch,
      fonts: e.fonts.system,
      image: e.container?.image ?? null,
      playwright: e.playwright,
    };
    console.log(
      `${type}: ${e.browser.version} · ${got.platform}/${got.arch} · fonts ${String(got.fonts).slice(0, 12)} · ${got.image} · id ${e.id}`
    );
    if (got.platform !== 'linux') fail(`${type}: platform ${got.platform}, not linux`);
    if (want.arch && got.arch !== want.arch) fail(`${type}: arch ${got.arch}, not ${want.arch}`);
    if (want.fonts && got.fonts !== want.fonts)
      fail(`${type}: fonts.system ${got.fonts}, not the label's ${want.fonts}`);
    if (want.image && got.image !== want.image)
      fail(`${type}: container.image ${got.image}, not ${want.image}`);
  }
} finally {
  await pool.close();
}
console.log('smoke: ok');
