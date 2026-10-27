import React from 'react';
export function Badge({ children, tone = 'neutral' }) {
  const colours = { neutral: '#5b6170', success: '#1f7a43', danger: '#b42318' };
  return (
    <span
      style={{
        font: '600 11px/1 ui-monospace, monospace',
        letterSpacing: 1,
        textTransform: 'uppercase',
        padding: '4px 8px',
        borderRadius: 4,
        color: '#fff',
        background: colours[tone],
      }}
    >
      {children}
    </span>
  );
}
