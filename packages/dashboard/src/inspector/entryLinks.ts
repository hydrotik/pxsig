/**
 * The entry's file paths and Storybook link (Inspector.tsx), held stable per entry: the memoised
 * side sections take them, and a new object on every render would render them again.
 */
import React from 'react';
import { type Data, type Row, pathsFor } from '../data';
import { storybookLink } from '../storybook-link.mjs';
import type { InspectTarget } from './Inspector';

export function useEntryLinks(data: Data, row: Row | null, scenario: InspectTarget['scenario']) {
  const p = React.useMemo(
    () => (row ? pathsFor(data, row.id, scenario) : null),
    [data, row, scenario]
  );
  const sbLink = React.useMemo(
    () => (row ? storybookLink(data.storybook.baseUrl, row, data.check?.manifest?.modes) : null),
    [data, row]
  );
  return { p, sbLink };
}
