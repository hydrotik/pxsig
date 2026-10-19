import React from 'react';
import { Button } from './Button';

export default { title: 'Components/Button', component: Button, args: { children: 'Save changes' } };

export const Primary = {};
export const Secondary = { args: { variant: 'secondary' } };
export const Disabled = {
  args: { disabled: true },
  // A per-story gate: tighter than the project's default.
  parameters: { pxsig: { gate: { minSsim: 0.995 } } },
};
