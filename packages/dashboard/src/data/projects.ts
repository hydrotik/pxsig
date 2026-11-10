/**
 * The server's projects (`/__pxsig/projects`, asked once per page): the picker's options, and the
 * project a bare `/report/` opens on when the server holds several.
 */
import React from 'react';
import { served, setCurrentProject } from './request';

export interface ProjectInfo {
  name: string;
  /** The project's `label`, when it has one. */
  label?: string | null;
  root: string;
  entries: number;
  integrity: { status: string; headline: string } | null;
}

let asked: Promise<ProjectInfo[]> | null = null;
/** The server's projects, in pxsig.workspace.json's order (empty for a static report, or on a failure). */
export function projectList(): Promise<ProjectInfo[]> {
  if (!served) return Promise.resolve([]);
  asked ??= fetch('/__pxsig/projects', { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ projects?: ProjectInfo[] }>)
    .then((b) => b.projects ?? [])
    .catch(() => []);
  return asked;
}

/** The server's projects (empty for a static report). */
export function useProjects(): ProjectInfo[] {
  const [list, setList] = React.useState<ProjectInfo[]>([]);
  React.useEffect(() => {
    let alive = true;
    void projectList().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/**
 * A page that names no project, on a server with several: the first one (the workspace file's
 * order) is shown, and the URL names it, so a reload or a shared link keeps it. The server never
 * picks one: a request without a project there is refused, and every write names the project.
 */
export async function nameFirstProject(): Promise<void> {
  const list = await projectList();
  if (list.length < 2) return;
  const first = list[0].name;
  setCurrentProject(first);
  const q = new URLSearchParams(location.search);
  q.set('project', first);
  history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
}
