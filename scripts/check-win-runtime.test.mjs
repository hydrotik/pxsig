import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vcRuntimeImports } from './check-win-runtime.mjs';

/** @param {string[]} names */
const pe = (...names) =>
  Buffer.concat([Buffer.from('MZ\0\0'), ...names.map((n) => Buffer.from(`${n}\0`, 'latin1'))]);

test('names the Visual C++ runtime DLLs a binary imports, once each', () => {
  assert.deepEqual(
    vcRuntimeImports(
      pe(
        'KERNEL32.dll',
        'VCRUNTIME140.dll',
        'vcruntime140_1.dll',
        'VCRUNTIME140.dll',
        'MSVCP140.dll'
      )
    ),
    ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
  );
});

test('the Universal CRT and system DLLs are part of Windows, not the redistributable', () => {
  assert.deepEqual(
    vcRuntimeImports(
      pe('KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'ucrtbase.dll', 'bcrypt.dll')
    ),
    []
  );
});
