import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createApp } from './app.js';

/**
 * Foundation smoke tests: confirm Vitest runs unit tests and that fast-check
 * property tests are wired. Domain properties are added in later tasks.
 */
describe('scaffolding foundation', () => {
  it('creates an Express app', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  it('runs fast-check property tests (addition is commutative)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 },
    );
  });
});
