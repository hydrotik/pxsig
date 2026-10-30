/**
 * The inspector's shortcuts (Inspector.tsx): on the window in the dialog; on the panel when
 * embedded, where the caller passes `onKey` to its keydown.
 */
import React from 'react';
import type { Row } from '../data';
import type { DiffViewerActions } from '../diff-viewer';
import { MODES } from './prefs';
import type { Mode } from './Stage';

export function useInspectorKeys({
  embedded,
  setMode,
  stage,
  stepRegion,
  step,
  canReview,
  busy,
  row,
  act,
}: {
  embedded: boolean;
  setMode: (mode: Mode) => void;
  stage: React.RefObject<DiffViewerActions | null>;
  stepRegion: (d: number) => unknown;
  step: (d: number) => void;
  canReview: boolean;
  busy: boolean;
  row: Row | null;
  act: (action: 'approve' | 'reject') => unknown;
}) {
  // The summary screen takes no shortcuts (A would re-approve the last entry).
  const blockKeys = React.useRef(false);
  const onKey = (
    e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'key' | 'target' | 'preventDefault'>
  ) => {
    if (blockKeys.current || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('[role="slider"]') && e.key.startsWith('Arrow')) return;
    const k = e.key;
    const run = (f: () => void) => (e.preventDefault(), f());
    if (k >= '1' && k <= '5') return run(() => setMode(MODES[Number(k) - 1]));
    if (k === 'f' || k === 'F') return run(() => stage.current?.fit());
    if (k === '0') return run(() => stage.current?.zoomTo(1));
    if (k === '+' || k === '=') return run(() => stage.current?.zoomBy(1.5));
    if (k === '-' || k === '_') return run(() => stage.current?.zoomBy(1 / 1.5));
    if (k === 'n') return run(() => stepRegion(1));
    if (k === 'N') return run(() => stepRegion(-1));
    if (k === 'ArrowRight' || k === 'j') return run(() => step(1));
    if (k === 'ArrowLeft' || k === 'k') return run(() => step(-1));
    if ((k === 'a' || k === 'A') && canReview && !busy && !row?.error)
      return run(() => act('approve'));
    if ((k === 'r' || k === 'R') && canReview && !busy) return run(() => act('reject'));
  };
  // In the dialog the shortcuts listen on the window: a button that disappears after a click
  // (Undo, Approve) drops focus to the page, and a listener on the inspector would miss them.
  const keyRef = React.useRef(onKey);
  // oxlint-disable-next-line react/refs -- the window listener calls this render's handler
  keyRef.current = onKey;
  React.useEffect(() => {
    if (embedded) return;
    const h = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      keyRef.current(e);
    };
    // Capture phase: controls inside the dialog stop some keys from bubbling.
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [embedded]);
  return { blockKeys, onKey };
}
