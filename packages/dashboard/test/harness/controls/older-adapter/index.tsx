/**
 * An adapter written for contract 1.1.0 (conformance.json), for test/ui-controls.test.mjs: the plain
 * adapter plus a Switch and a Slider of its own that know nothing of `disabled`. The dashboard draws
 * the fallback for either one while it is disabled.
 */
import type * as C from '../../../../src/ui/contract';

export * from '../../../../src/ui/adapters/plain';
export const name = 'older';

export const Switch = ({ checked, onCheckedChange, label }: C.SwitchProps) => (
  <button
    type="button"
    role="switch"
    data-own
    aria-checked={checked}
    aria-label={label}
    onClick={() => onCheckedChange(!checked)}
  />
);

export const Slider = ({ label, value, onValueChange, min, max }: C.SliderProps) => (
  <input
    type="range"
    data-own
    aria-label={label}
    min={min}
    max={max}
    value={value}
    onChange={(e) => onValueChange(Number(e.target.value))}
  />
);
