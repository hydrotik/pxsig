/**
 * A page for the TextField tests (test/ui-text-field.test.mjs): `@ui`'s TextField, built with
 * whichever adapter the test picks, inside a form and a key listener. Every callback, a form
 * submit and each key that reaches the listener are logged to `window.harness.log`.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TextField, UiRoot } from '@ui';

const log: unknown[][] = [];

function Field() {
  const [value, setValue] = React.useState('');
  return (
    <UiRoot>
      <form onSubmit={(e) => (e.preventDefault(), log.push(['form']))}>
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a test listener */}
        <div onKeyDown={(e) => log.push(['key', e.key])}>
          <TextField
            label="Reason"
            placeholder="One line"
            value={value}
            maxLength={10}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the contract's prop under test
            autoFocus
            onValueChange={(v) => (log.push(['value', v]), setValue(v))}
            onSubmit={(v) => log.push(['submit', v])}
          />
        </div>
      </form>
    </UiRoot>
  );
}

createRoot(document.getElementById('root')!).render(<Field />);
Object.assign(window, { harness: { log } });
