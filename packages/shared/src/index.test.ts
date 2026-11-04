import { describe, expect, it } from 'vitest';
import { calculatedRouteConfidence } from './index.js';

describe('route provenance', () => {
  it('never automatically confirms a computed route', () => {
    expect(calculatedRouteConfidence()).toBe('estimated');
  });
});
