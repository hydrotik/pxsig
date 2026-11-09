/**
 * The inspector's Files section (Inspector.tsx): the entry's files, its open rejections' packets
 * (rejection.md, served to this origin only) and the story.
 */
import React from 'react';
import { Button, Link } from '@ui';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import type { Data, pathsFor } from '../../data';

/** Copies a file's path in the repository; says so for a moment after. */
function CopyPath({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard refused: the path is in the title */
    }
  };
  return (
    <Button
      size="sm"
      emphasis="ghost"
      title={value}
      aria-label={t(done ? 'inspector.files.pathCopied' : 'inspector.files.path', { label })}
      onClick={copy}
    >
      {done ? t('inspector.files.copied') : t('inspector.files.copyPath')}
    </Button>
  );
}

/**
 * The rejection packets of `id`'s open rejections, as [label, URL of rejection.md]: the packet's
 * store-relative folder (`reports/rejected/<id>/`) under the server's `paths.rejected`.
 */
export function packetsOf(data: Data, id: string): [string, string][] {
  const base = data.paths.rejected;
  if (!base || data.static) return [];
  return (
    [
      ['visual', 'inspector.files.packet'],
      ['a11y', 'inspector.files.a11yPacket'],
    ] as const
  ).flatMap(([kind, label]) => {
    const folder = data.rejections?.[kind]?.[id]?.packet;
    return folder
      ? [[t(label), `${base}${folder.replace(/^reports\/rejected\//, '')}rejection.md`]]
      : [];
  }) as [string, string][];
}

export function FilesSection({
  data,
  p,
  hasArtifacts,
  sizes,
  sb,
  packets = [],
}: {
  data: Data;
  p: NonNullable<ReturnType<typeof pathsFor>>;
  hasArtifacts: boolean;
  sizes: Record<string, string>;
  /** Null: no Storybook (pxsig's own screens). */
  sb: string | null;
  /** The open rejections' packets: [label, URL] (packetsOf). */
  packets?: [string, string][];
}) {
  // A served URL (/p/<project>/renders/…) or a static one (./renders/…) → the file in the store.
  const repoPath = (u: string) =>
    `${data.store ?? '.pxsig'}/${u.replace(/^\/p\/[^/]+\//, '').replace(/^\.\//, '')}`;
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.files')}</h3>
      <ul className={s.resources}>
        {(
          [
            [p.beforeLabel, p.before],
            [p.afterLabel, p.after],
            ...(hasArtifacts
              ? [
                  [t('inspector.files.baseSig'), p.baseSig],
                  [t('inspector.files.curSig'), p.curSig],
                  [t('inspector.files.heat'), p.heat],
                  [t('inspector.files.page'), p.page],
                ]
              : []),
            ...(p.record ? [[t('inspector.files.record'), p.record]] : []),
            ...packets,
          ] as [string, string][]
        ).map(([label, url]) => (
          <li key={label}>
            <Link href={url} external className={s.grow}>
              {label}
            </Link>
            <span className={`${s.mono} ${s.muted}`}>{sizes[url] ?? ''}</span>
            <CopyPath value={repoPath(url)} label={label} />
          </li>
        ))}
        {sb ? (
          <li>
            <Link href={sb} external className={s.grow}>
              {t('inspector.files.storybook')}
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
