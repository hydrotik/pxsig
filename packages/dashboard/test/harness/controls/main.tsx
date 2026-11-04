/**
 * A page for the disabled-control tests (test/ui-controls.test.mjs): `@ui`'s Switch and Slider, built
 * with whichever adapter the test picks. `window.harness.mount(disabled)` re-renders them (synchronously)
 * enabled or disabled; every callback is logged to `window.harness.log`.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Slider, Switch, UiRoot } from '@ui';

const log: unknown[][] = [];

function Controls({ disabled }: { disabled: boolean }) {
  const [checked, setChecked] = React.useState(false);
  const [value, setValue] = React.useState(5);
  return (
    <UiRoot>
      <Switch
        label="Regions"
        checked={checked}
        onCheckedChange={(c) => (log.push(['switch', c]), setChecked(c))}
        disabled={disabled}
      />
      <Slider
        label="Tolerance"
        value={value}
        min={0}
        max={10}
        onValueChange={(v) => (log.push(['slider', v]), setValue(v))}
        disabled={disabled}
      />
    </UiRoot>
  );
}

const root = createRoot(document.getElementById('root')!);
function mount(disabled: boolean) {
  log.length = 0;
  flushSync(() => root.render(<Controls key={String(disabled)} disabled={disabled} />));
}
Object.assign(window, { harness: { mount, log } });
mount(false);
