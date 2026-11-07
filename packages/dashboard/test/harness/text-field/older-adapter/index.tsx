/**
 * An adapter written for contract 1.4.0 (conformance.json), for test/ui-text-field.test.mjs: the
 * plain adapter without its TextField, so the dashboard draws the fallback.
 */
export * from '../../../../src/ui/adapters/plain';
export const name = 'older';
export const TextField = undefined;
