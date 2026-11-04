import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point to a migrated, disposable test database.');
}

const port = 31987;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['apps/api/dist/server.js'], {
  env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port) },
  stdio: 'ignore',
});
let exited = false;
child.once('exit', () => {
  exited = true;
});

try {
  let lastError;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (exited) throw new Error('Compiled API exited before becoming ready.');
    try {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok' });

      const trips = await fetch(`${baseUrl}/api/v1/trips`);
      assert.equal(trips.status, 200);
      assert.ok(Array.isArray(await trips.json()), 'Trips endpoint must return a JSON array.');
      ready = true;
      break;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  assert.ok(ready, `Compiled API did not respond: ${lastError?.message ?? 'timeout'}`);
  console.log('Compiled API startup and migrated database HTTP smoke test passed.');
} finally {
  if (!exited) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([stopped, sleep(3000)]);
  }
}
