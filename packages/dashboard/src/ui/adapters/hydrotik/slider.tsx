/**
 * The reference adapter's Slider: one control on one line (slider.css.ts), so it sits in the
 * inspector toolbar at the height of the buttons beside it. The label names the thumb; the thumb
 * announces the value, so the visible copy is hidden from assistive technology.
 */
import React from 'react';
import * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';
import * as sl from './slider.css';

export function Slider({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  formatValue,
  className,
}: C.SliderProps) {
  const id = React.useId();
  return (
    <span data-control className={[sl.root, className].filter(Boolean).join(' ')}>
      <span id={id}>{label}</span>
      <DS.Slider
        className={sl.track}
        aria-labelledby={id}
        {...(formatValue ? { formatValue: ([v]: number[]) => formatValue(v) } : {})}
        value={[value]}
        {...(min !== undefined ? { min } : {})}
        max={max}
        {...(step !== undefined ? { step } : {})}
        onValueChange={([v]: number[]) => onValueChange(v)}
      />
      <output className={sl.value} aria-hidden="true">
        {formatValue ? formatValue(value) : value}
      </output>
    </span>
  );
}
