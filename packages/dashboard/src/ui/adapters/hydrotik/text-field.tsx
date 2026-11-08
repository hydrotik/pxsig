/**
 * The reference adapter's TextField (contract 1.5.0): hydrotik's Input with its own visible label,
 * stretched to its container. Enter calls `onSubmit`, except while an input method is composing.
 * index.tsx passes DS.Input in (as slider.tsx), so every design-system part the adapter uses is
 * named in that one file.
 */
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';

export const textField = (Input: typeof DS.Input) =>
  function TextField({
    label,
    value,
    onValueChange,
    maxLength,
    placeholder,
    onSubmit,
    autoFocus,
  }: C.TextFieldProps) {
    return (
      <Input
        type="text"
        label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the contract's prop: the caller opens the field on a key
        autoFocus={autoFocus}
        fullWidth
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !onSubmit) return;
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        }}
      />
    );
  };
