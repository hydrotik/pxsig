/**
 * types.d.ts — the shapes pxsig's JavaScript passes around, for its JSDoc (`checkJs`) and for
 * `oxlint --type-aware`. Types only: nothing here runs. A module imports what it needs with
 * `/** @import { Workspace } from '../types.js' *\/`.
 *
 * The file formats themselves (manifest, `.psig`, approval log, reports) are specified in
 * docs/spec.md; a shape here follows that document, never the other way round. Each section
 * belongs to the modules named in its heading; add to the section of the module you type.
 */

export type {
  Flags,
  ProjectRef,
  WorkspaceFile,
  ConfigFile,
  PackageJson,
  Workspace,
  Size,
  Mode,
  DetailGate,
  Gate,
  GateMode,
  Config,
  Store,
  Project,
  SetupProblem,
  PeerBase,
  ImageTag,
  UnknownFlag,
  HelpCommand,
  HelpCommands,
} from './types/config.js';
export type {
  TornLine,
  PsigSection,
  PsigHeader,
  InteractionState,
  StoryPxsigParameters,
  StoryParameters,
  StorybookPreviewWindow,
  ManifestEntry,
  ManifestSkipped,
  Manifest,
  StoryRef,
  EntryConfig,
  RunManifest,
  ApprovalLine,
  IndexStory,
  StoryIndex,
} from './types/store.js';
export type {
  EnvTier,
  EnvRecord,
  EnvFields,
  EnvBrowser,
  RemoteBrowser,
  EnvProbe,
  EnvMatch,
  EnvComparison,
  EnvSummary,
  EnvSettings,
} from './types/env.js';
export type {
  A11yViolation,
  A11yResult,
  EngineResult,
  RenderResult,
  CheckRow,
  CheckSummary,
  MachineOptions,
  AgentMarker,
  DetectedAgent,
  McpRecipe,
  Assistant,
  StaticServer,
  LockBody,
  LockState,
  LockHandle,
  LockOptions,
  SarifRule,
  SarifResult,
  SarifLog,
  Tokens,
  Authorization,
} from './types/run.js';
