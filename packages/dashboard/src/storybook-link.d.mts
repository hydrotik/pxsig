/** Types for storybook-link.mjs (plain JS so the pxsig tests import it without a build). */
export function storybookLink(
  baseUrl: string,
  row: {
    id: string;
    story?: string;
    mode?: string | null;
    state?: string | null;
    globals?: string | null;
  },
  modes?: Record<string, { globals?: string }> | null
): { url: string; globals: string; state: string | null };
