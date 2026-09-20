/**
 * Public entry point for the pure domain module.
 *
 * Re-exports shared domain types and enums. Additional pure domain logic
 * (ranking, scheduling, awards, etc.) will be re-exported from here as it is
 * implemented in later tasks.
 */

export * from './types.js';
export * from './auth.js';
export * from './errors.js';
