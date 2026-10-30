/**
 * hydrotik-types.mjs — the declarations the reference adapter (packages/dashboard/src/ui/adapters/
 * hydrotik/) is type-checked and linted against without a design-system checkout.
 *
 * `node scripts/ui.mjs types` writes them, with PXSIG_DS_SOURCE naming a built checkout of the
 * design-system monorepo. Only the names the adapter imports are declared: its import lines and its
 * `DS.<name>` uses are read, and the design system's own `.d.mts` files (its `dist`) are bundled
 * for exactly those names by the checkout's rolldown and rolldown-plugin-dts, with everything they
 * reach inlined except React and vanilla-extract (this repository has their types). The bundle is
 * one ambient module; each import specifier the adapter uses re-exports its names from it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagesIn } from '../../packages/dashboard/src/ui/adapters/hydrotik/vite.mjs';

export const adapterDir = path.join(
  import.meta.dirname,
  '../../packages/dashboard/src/ui/adapters/hydrotik'
);
export const typesFile = path.join(adapterDir, 'design-system.d.ts');

/** The modules the declarations cover: specifier → the package and its `dist` declarations. */
const MODULES = {
  '@hydrotik/design-system': ['@hydrotik/design-system', 'dist/index.d.mts'],
  '@hydrotik/design-system/chart': ['@hydrotik/design-system', 'dist/chart.d.mts'],
  '@hydrotik/design-system/fonts': ['@hydrotik/design-system', 'dist/fonts.d.mts'],
  '@hydrotik/design-system/styles': ['@hydrotik/design-system', 'dist/styles.d.mts'],
  '@hydrotik/theme-provider': ['@hydrotik/theme-provider', 'dist/index.d.mts'],
  '@hydrotik/tokens': ['@hydrotik/tokens', 'dist/index.d.mts'],
};
/** Imported by the adapter from the design system's own copy (vite.mjs aliases it there too). */
const THIRD_PARTY = ['recharts'];
/** Left as imports: this repository has their types (root devDependencies). */
const KEEP = /^(react|react-dom|csstype|@vanilla-extract\/css)(\/|$)/;
/** Namespace exports declared with only the members the adapter uses (lucide's icon set). */
const NARROW = new Set(['Icons']);
/** The ambient module the bundle lives in; never imported by the adapter itself. */
const BUNDLE = 'pxsig:hydrotik-design-system';

/**
 * What the adapter imports, per specifier: the names (with the members used of NARROW ones).
 * @param {string} dir
 * @returns {Map<string, Map<string, Set<string>>>}
 */
export function adapterImports(dir = adapterDir) {
  /** @type {Map<string, Map<string, Set<string>>>} */
  const out = new Map();
  const covered = (/** @type {string} */ s) => s in MODULES || THIRD_PARTY.includes(s);
  /** @param {string} spec */
  const of = (spec) => {
    /** @type {Map<string, Set<string>> | undefined} */
    let names = out.get(spec);
    if (!names) out.set(spec, (names = /** @type {Map<string, Set<string>>} */ (new Map())));
    return names;
  };
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f) || f.endsWith('.d.ts')) continue;
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(
      /^import\s+(type\s+)?([^'";]*?)\s*(?:from\s+)?['"]([^'"]+)['"]/gm
    )) {
      const [, , clause, spec] = m;
      if (!covered(spec)) continue;
      const names = of(spec);
      const ns = /^\*\s+as\s+(\w+)$/.exec(clause);
      if (ns) {
        for (const [, name, member] of text.matchAll(
          new RegExp(`\\b${ns[1]}\\.(\\w+)(?:\\.(\\w+))?`, 'g')
        )) {
          /** @type {Set<string> | undefined} */
          let set = names.get(name);
          if (!set) names.set(name, (set = new Set()));
          if (member && NARROW.has(name)) set.add(member);
        }
        continue;
      }
      const list = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
      for (const part of list.split(',')) {
        const name = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (name) names.set(name, names.get(name) ?? new Set());
      }
    }
  }
  return out;
}

/**
 * A map's entries by key, so the output does not depend on the order files were read in.
 * @template V
 * @param {Map<string, V>} m
 */
const sorted = (m) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** @param {string} spec @param {string} name */
const alias = (spec, name) => `${spec.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '_')}$${name}`;

/**
 * The bundle's entry: every imported name re-exported under a collision-free alias.
 * @param {Map<string, Map<string, Set<string>>>} imports
 */
function entryText(imports) {
  const lines = [];
  for (const [spec, names] of sorted(imports)) {
    for (const [name, members] of sorted(names)) {
      if (NARROW.has(name)) {
        const local = alias(spec, name);
        lines.push(`import { ${name} as ${local}_all } from '${spec}';`);
        const body = [...members].sort().map((m) => `readonly ${m}: typeof ${local}_all.${m};`);
        lines.push(`declare const ${local}: { ${body.join(' ')} };`, `export { ${local} };`);
      } else lines.push(`export { ${name} as ${alias(spec, name)} } from '${spec}';`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Generate the declarations file's text from a design-system checkout.
 * @param {string} source the checkout (PXSIG_DS_SOURCE)
 * @param {{ scratch: string }} opts a directory for the bundle's entry file
 * @returns {Promise<string>}
 */
export async function generate(source, { scratch }) {
  const pkgs = packagesIn(source);
  /** @param {string} name */
  const need = (name) => {
    const dir = pkgs[name];
    if (!dir) throw new Error(`[ui] ${name} not found in PXSIG_DS_SOURCE`);
    return dir;
  };
  const ds = need('@hydrotik/design-system');
  /** @type {Record<string, string>} */
  const files = {};
  for (const [spec, [pkg, rel]] of Object.entries(MODULES)) {
    files[spec] = path.join(need(pkg), rel);
    if (!existsSync(files[spec]))
      throw new Error(`[ui] ${pkg} has no ${rel}: build the design system first`);
  }
  const dsRequire = createRequire(path.join(ds, 'package.json'));
  for (const name of THIRD_PARTY) {
    const dir = path.dirname(dsRequire.resolve(`${name}/package.json`));
    const { types, typings } = /** @type {{ types?: string, typings?: string }} */ (
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    );
    if (!(types ?? typings)) throw new Error(`[ui] ${name} names no declarations`);
    files[name] = path.join(dir, types ?? typings ?? '');
  }
  // The checkout's own bundler (tsdown's), so the declarations match how the design system builds.
  const toolRequire = createRequire(dsRequire.resolve('tsdown'));
  /** @param {string} name */
  const load = (name) => import(pathToFileURL(toolRequire.resolve(name)).href);
  const { rolldown } =
    /** @type {{ rolldown: (o: object) => Promise<{ generate: (o: object) => Promise<{ output: { code?: string }[] }> }> }} */ (
      await load('rolldown')
    );
  const { dts } = /** @type {{ dts: (o: object) => object }} */ (await load('rolldown-plugin-dts'));

  const imports = adapterImports();
  mkdirSync(scratch, { recursive: true });
  const entry = path.join(scratch, 'entry.d.ts');
  writeFileSync(entry, entryText(imports));
  const bundle = await rolldown({
    input: { entry },
    external: (/** @type {string} */ id) => KEEP.test(id),
    logLevel: 'silent',
    plugins: [
      {
        name: 'pxsig-ds-modules',
        /** @param {string} id @param {string | undefined} importer */
        resolveId(id, importer) {
          if (files[id]) return files[id];
          // A package whose declarations are in DefinitelyTyped (d3-shape, for recharts).
          if (importer && !id.startsWith('.') && !KEEP.test(id)) return typesPackage(id, importer);
          // A `.js` import in a package's declarations whose types are a sibling `.ts` (not `.d.ts`).
          if (importer && id.startsWith('.') && id.endsWith('.js')) {
            const base = path.resolve(path.dirname(importer), id.slice(0, -3));
            if (!existsSync(`${base}.d.ts`) && existsSync(`${base}.ts`)) return `${base}.d.ts`;
          }
          return null;
        },
        /** @param {string} id */
        load(id) {
          const ts = id.replace(/\.d\.ts$/, '.ts');
          return id.endsWith('.d.ts') && !existsSync(id) && existsSync(ts)
            ? readFileSync(ts, 'utf8')
            : null;
        },
      },
      dts({ dtsInput: true, emitDtsOnly: true, generator: 'oxc', tsconfig: false, cwd: ds }),
    ],
  });
  const { output } = await bundle.generate({ format: 'es' });
  const code = output[0]?.code;
  if (!code) throw new Error('[ui] the declarations bundle is empty');
  return wrap(code, imports, versions(pkgs));
}

/**
 * `@types/<name>`'s declarations, for a package that ships none, as resolved from `importer`.
 * @param {string} id
 * @param {string} importer
 * @returns {string | null}
 */
function typesPackage(id, importer) {
  const req = createRequire(importer);
  const name = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
  /** @param {string} pkg */
  const manifest = (pkg) => {
    // Looked up along node_modules, not resolved: `exports` may hide package.json.
    const dir = (req.resolve.paths(pkg) ?? [])
      .map((d) => path.join(d, pkg))
      .find((d) => existsSync(path.join(d, 'package.json')));
    if (!dir) return null;
    const json = /** @type {{ types?: string, typings?: string }} */ (
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    );
    return { dir, types: json.types ?? json.typings };
  };
  const own = manifest(name);
  if (!own || own.types || id !== name) return null;
  const at = manifest(`@types/${name.replace(/^@/, '').replace('/', '__')}`);
  return at ? path.join(at.dir, at.types ?? 'index.d.ts') : null;
}

/** @param {Record<string, string>} pkgs */
function versions(pkgs) {
  return [...new Set(Object.values(MODULES).map(([p]) => p))].map((p) => {
    const { version } = /** @type {{ version: string }} */ (
      JSON.parse(readFileSync(path.join(pkgs[p], 'package.json'), 'utf8'))
    );
    return `${p}@${version}`;
  });
}

/**
 * The bundle as one ambient module, then a module per specifier re-exporting its names.
 * @param {string} code
 * @param {Map<string, Map<string, Set<string>>>} imports
 * @param {string[]} from
 */
function wrap(code, imports, from) {
  let doc = false;
  const body = code
    .split('\n')
    .filter(
      (l) => !['//#region', '//#endregion', '//# sourceMappingURL'].some((p) => l.startsWith(p))
    )
    // JSDoc blocks on their own lines: documentation, not types (a third of the bundle).
    .filter((l) => {
      const t = l.trim();
      if (!doc && !t.startsWith('/**')) return true;
      doc = !t.endsWith('*/');
      return false;
    })
    // Already ambient inside `declare module`: a top-level `declare` is an error there.
    .map((l) => l.replace(/^(export )?declare /, '$1'))
    .map((l) => (l ? `  ${l}` : l))
    .join('\n')
    .trimEnd();
  const modules = sorted(imports).map(([spec, names]) => {
    const list = sorted(names)
      .map(([n]) => n)
      .map((n) => `${alias(spec, n)} as ${n}`)
      .join(', ');
    return list
      ? `declare module '${spec}' {\n  export { ${list} } from '${BUNDLE}';\n}`
      : `declare module '${spec}' {}`;
  });
  const text = [
    "// Generated by `node scripts/ui.mjs types` from the design system's own declarations",
    `// (${from.join(', ')}): the names the reference adapter imports, nothing else. Do not edit.`,
    `declare module '${BUNDLE}' {`,
    body,
    '}',
    ...modules,
    '',
  ].join('\n');
  // Every import the bundle kept must resolve here too: anything else would type as `any`.
  for (const [, spec] of body.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm))
    if (!KEEP.test(spec)) throw new Error(`[ui] the declarations import ${spec}, not bundled`);
  // Nothing from the machine that generated it.
  const leak = /(\/Users\/|\/home\/|[A-Z]:\\|node_modules\/\.pnpm)/.exec(text);
  if (leak) throw new Error(`[ui] the declarations contain a local path (${leak[0]})`);
  return text;
}
