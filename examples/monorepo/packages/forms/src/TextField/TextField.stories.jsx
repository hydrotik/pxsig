import React from 'react';
import { TextField } from './TextField';

export default { title: 'Forms/TextField', component: TextField, args: { label: 'Email' } };

export const Empty = {};
export const Filled = { args: { value: 'someone@example.com' } };
export const WithAction = {
  args: { action: 'Invite' },
  // An interaction state: also capture the field with focus.
  parameters: { pxsig: { states: [{ name: 'focused', action: 'focus', target: 'input' }] } },
};
