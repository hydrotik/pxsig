/**
 * types/serve.d.ts — the server's own shapes (src/serve/): the context every module takes, and the
 * route table `dispatch` walks (serve/routes.mjs). Types only: nothing here runs.
 */
import type { FSWatcher } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { browserPool } from '../lib/capture.mjs';
import type { Links } from '../lib/guard.mjs';
import type { ProjectState } from '../serve/projects.mjs';
import type { Authorization, Flags, Tokens, Workspace } from '../types.js';
import type { EngineMethod, EngineMethods, RequestBody } from './t5.js';

/** One server's state (serve/create.mjs): created once, passed to every module as `srv`. */
export interface ServeContext {
  ws: Workspace;
  flags: Flags;
  states: Map<string, ProjectState>;
  /** A project's Storybook origins; grows when the server serves a static build. */
  allowedOrigins: Set<string>;
  tokens: Tokens;
  links: Links;
  /** One call to the engine (serve/engine.mjs). */
  rust<M extends EngineMethod>(
    method: M,
    params: EngineMethods[M]['params']
  ): Promise<EngineMethods[M]['result']>;
  /** Stops the engine, when one is running. */
  kill(): void;
  /** One event to every page on `/__pxsig/events`. */
  broadcast(event: string, data?: Record<string, unknown>): void;
  clients: Set<ServerResponse>;
  /** Created by the first check. */
  pool: ReturnType<typeof browserPool> | null;
  /** Set once the server listens. */
  url: string | null;
  routes: Map<string, Route>;
  /** The `server.json` path. */
  info: string;
  server: Server;
  /** The file watchers (serve/watch.mjs), closed by `stop()`. */
  watchers: Set<FSWatcher>;
}

/**
 * What a route's `run` gets. `S` is set from the GET routes on (`project: 'query'`) and for POST
 * routes with `project: 'body'`; `body` and `auth` for `authorized` POST routes.
 */
export interface RouteContext {
  srv: ServeContext;
  req: IncomingMessage;
  res: ServerResponse;
  q: URLSearchParams;
  action: string;
  body: RequestBody;
  S: ProjectState;
  auth: Extract<Authorization, { ok: true }>;
}

/** One `/__pxsig/<action>` (serve/routes.mjs). */
export interface Route {
  /** `any` answers every method, before the GET / POST split. */
  methods: 'any' | 'GET' | 'POST';
  /** Where in `dispatch` it runs: before the guard (`pre-auth`), after it and the body, or `open`. */
  stage: 'open' | 'pre-auth' | 'authorized';
  /** How it picks its project: none, `?project=`, the body's, or split across projects (`check`). */
  project: 'none' | 'query' | 'body' | 'split';
  run(cx: RouteContext): Promise<void> | void;
}
