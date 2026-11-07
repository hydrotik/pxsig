/**
 * The text field's plain rendering (fallbacks.tsx, contract 1.5.0): a native `<label>` above a
 * native text `<input>`, which keeps the browser's focus outline. Enter calls `onSubmit`, except
 * while an input method is composing.
 */
import React from 'react';
import { tokens as v } from '../tokens';
import { control, type F } from './base';

export const TextField: F<'TextField'> = ({
  label,
  value,
  onValueChange,
  maxLength,
  placeholder,
  onSubmit,
  autoFocus,
}) => {
  const id = React.useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: v.space['1'], minInlineSize: 0 }}>
      <label htmlFor={id} style={{ fontSize: v.fontSize.xs, color: v.color.textMuted }}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the contract's prop: the caller opens the field on a key
        autoFocus={autoFocus}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !onSubmit) return;
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        }}
        style={{ ...control, inlineSize: '100%' }}
      />
    </div>
  );
};
