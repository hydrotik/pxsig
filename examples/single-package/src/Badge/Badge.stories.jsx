import React from 'react';
import { Badge } from './Badge';

export default { title: 'Components/Badge', component: Badge, args: { children: 'Draft' } };

export const Neutral = {};
export const Success = { args: { tone: 'success', children: 'Live' } };
export const Danger = { args: { tone: 'danger', children: 'Failed' } };
