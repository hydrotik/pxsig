/** The build-selected adapter module (vite.config.mjs aliases it): named exports, see ./contract.ts `UiAdapter`. */
declare module '@ui-adapter' {
  export const name: string;
  export const tokens: import('./contract').TokenMap;
}
