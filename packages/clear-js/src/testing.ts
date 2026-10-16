/** Test helpers. Fake keys are built at run time, so no key-shaped string sits in the source. */
export const fakeKey = (mode: 'test' | 'live', kind: 'pk' | 'sk' = 'pk') => ['clear', kind, mode, 'Ab3'.repeat(8)].join('_');
