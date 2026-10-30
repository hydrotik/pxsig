/** Requests to the pxsig server (data.ts): whether the page is served, and the project in view. */
export const served =
  typeof location !== 'undefined' && location.protocol.startsWith('http') && !window.PXSIG?.static;

/** The project in view: `?project=` in the URL, else the one owning `?story=` (the Storybook panel). */
export const query =
  typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export let currentProject: string | null = query.get('project');
export const scope = () =>
  currentProject
    ? `?project=${encodeURIComponent(currentProject)}`
    : query.get('story')
      ? `?story=${encodeURIComponent(query.get('story')!)}`
      : '';
export const withProject = (body: object) =>
  JSON.stringify(currentProject ? { project: currentProject, ...body } : body);

/** A refused request's answer: `error` says why (server.md). */
export type Refusal = { error?: string };

/** The project the server answered for (fetchData in data.ts). */
export const setCurrentProject = (p: string | null) => {
  currentProject = p;
};
