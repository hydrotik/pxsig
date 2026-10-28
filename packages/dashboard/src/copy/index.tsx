/**
 * The dashboard's copy. Every user-facing string lives in a locale file (en.json); views read it
 * through `t` (plain text) or `tx` (text with React nodes in its placeholders).
 *
 *   "Show more ({count} remaining)"            {name} placeholders
 *   { "one": "{count} entry", "other": "…" }   plural forms, chosen by Intl.PluralRules on `count`
 *
 * A new locale is a sibling JSON file with the same keys, added to LOCALES. Missing keys fall back
 * to English. Numbers in placeholders are formatted for the locale.
 */
import React from 'react';
import en from './en.json';

type Messages = typeof en;
type Plural = { one?: string; other: string; [form: string]: string | undefined };

/** Dot paths to every message: a string, or a plural object (one of its keys is `other`). */
type Keys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends { other: string }
      ? `${P}${K}`
      : Keys<T[K], `${P}${K}.`>;
}[keyof T & string];
export type CopyKey = Keys<Messages>;
type Vars = Record<string, string | number | null | undefined>;

const LOCALES: Record<string, unknown> = { en };

function pickLocale(): string {
  const wanted =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of wanted) {
    if (LOCALES[tag]) return tag;
    const base = tag.split('-')[0];
    if (LOCALES[base]) return base;
  }
  return 'en';
}

export const locale = pickLocale();
const plurals = new Intl.PluralRules(locale);
const numbers = new Intl.NumberFormat(locale);

function lookup(table: unknown, key: string): string | Plural | undefined {
  let node = table;
  for (const part of key.split('.'))
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === 'string' || (node && typeof node === 'object' && 'other' in node)
    ? (node as string | Plural)
    : undefined;
}

function message(key: string, count: unknown): string {
  const m = lookup(LOCALES[locale], key) ?? lookup(en, key);
  if (m === undefined) {
    if (import.meta.env?.DEV) console.warn(`[copy] missing key ${key}`);
    return key;
  }
  if (typeof m === 'string') return m;
  return (typeof count === 'number' ? m[plurals.select(count)] : undefined) ?? m.other;
}

const show = (v: Vars[string]) => (typeof v === 'number' ? numbers.format(v) : String(v ?? ''));

/** A message as text. */
export function t(key: CopyKey, vars: Vars = {}): string {
  return message(key, vars.count).replace(/\{(\w+)\}/g, (all, name: string) =>
    name in vars ? show(vars[name]) : all
  );
}

/** Whether a key exists (for message tables keyed by data, such as coverage codes). */
export function has(key: string): boolean {
  return lookup(en, key) !== undefined;
}

/** A message with React nodes in its placeholders, e.g. a command in <code>. */
export function tx(key: CopyKey, vars: Record<string, React.ReactNode>): React.ReactNode {
  const parts = message(key, vars.count).split(/\{(\w+)\}/g);
  return parts.map((p, i) =>
    i % 2 ? (
      <React.Fragment key={i}>
        {p in vars
          ? typeof vars[p] === 'number'
            ? numbers.format(vars[p] as number)
            : vars[p]
          : `{${p}}`}
      </React.Fragment>
    ) : (
      p
    )
  );
}

/** A coverage code's title and help, falling back to the raw code for one this build does not know. */
export function codeCopy(code: string): { title: string; help: string } {
  const base = `coverage.codes.${code}`;
  return has(`${base}.title`)
    ? { title: t(`${base}.title` as CopyKey), help: t(`${base}.help` as CopyKey) }
    : { title: code, help: '' };
}

/** A command or file name inside a message. */
export const Cmd = ({ children }: { children: React.ReactNode }) => <code>{children}</code>;
