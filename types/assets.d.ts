/** Stylesheets and plain modules the bundler handles, for the type check. */
declare module '*.css';
declare module '*.mjs';

/** The part of Vite's import.meta.env the dashboard reads. */
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/** Font packages the design system imports for their CSS only. */
declare module '@fontsource-variable/*';
