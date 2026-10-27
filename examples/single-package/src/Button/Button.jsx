import React from 'react';
export function Button({ children, variant = 'primary', disabled = false }) {
  const bg = variant === 'primary' ? '#2f5bea' : 'transparent';
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        font: '600 14px/1 system-ui, sans-serif',
        padding: '10px 16px',
        borderRadius: 6,
        border: '1px solid #2f5bea',
        background: bg,
        color: variant === 'primary' ? '#fff' : 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
