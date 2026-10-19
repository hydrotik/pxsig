import React from 'react';
import { Button } from '@example/ui';

export function TextField({ label, value = '', action = null }) {
  return (
    <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', font: '14px/1.2 system-ui, sans-serif' }}>
      <span>{label}</span>
      <input defaultValue={value} style={{ font: 'inherit', padding: '8px 10px', borderRadius: 6, border: '1px solid #9aa0ab', inlineSize: '14rem' }} />
      {action ? <Button>{action}</Button> : null}
    </label>
  );
}
