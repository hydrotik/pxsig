import React from 'react';
export function Button({ children, tone = 'accent' }) {
  return (
    <button
      type="button"
      style={{
        font: '600 14px/1 system-ui, sans-serif',
        padding: '10px 16px',
        borderRadius: 6,
        border: 0,
        color: '#fff',
        background: tone === 'accent' ? '#2f5bea' : '#5b6170',
      }}
    >
      {children}
    </button>
  );
}
