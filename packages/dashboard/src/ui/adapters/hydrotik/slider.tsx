/**
 * The reference adapter's Slider: one control on one line (slider.css.ts), so it sits in the
 * inspector toolbar at the height of the buttons beside it. The label names the thumb; the thumb
 * announces the value, so the visible copy is hidden from assistive technology. index.tsx passes
 * DS.Slider in, so every design-system part the adapter uses is named in that one file (the
 * catalog, docs/ui/catalog/hydrotik.catalog.json, is read from it).
 */
import React from 'react';
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';
import * as sl from './slider.css';

export const oneLineSlider = (Track: typeof DS.Slider) =>
  function Slider({
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
        <Track
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
  };
