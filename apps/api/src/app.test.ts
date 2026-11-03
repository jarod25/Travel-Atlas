import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('API health check', () => {
  it('returns OK without accessing external services', async () => {
    const app = buildApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
