import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

if (!process.env.DATABASE_URL || process.env.ATLAS_SMOKE_DISPOSABLE !== '1') {
  throw new Error(
    'Set DATABASE_URL to a disposable migrated PostGIS database and ATLAS_SMOKE_DISPOSABLE=1.',
  );
}

const apiPort = 3001;
const webPort = 31888;
const webUrl = `http://127.0.0.1:${webPort}`;
const children = [];
function start(file, args, cwd) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(apiPort) },
    stdio: 'ignore',
  });
  children.push(child);
  return child;
}

async function awaitReady(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Process exited before ${url} became available`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Service ${url} unavailable: ${lastError?.message}`);
}

async function json(path, method = 'GET', body, revision, expectedStatus = 200) {
  const response = await fetch(webUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, expectedStatus, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

try {
  const api = start('apps/api/dist/server.js', [], process.cwd());
  await awaitReady(`http://127.0.0.1:${apiPort}/health`, api);
  const web = start(
    'node_modules/vite/bin/vite.js',
    ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    'apps/web',
  );
  const page = await awaitReady(webUrl, web);
  assert.match(await page.text(), /<div id="root"><\/div>/);
  const entry = await awaitReady(`${webUrl}/src/main.tsx`, web);
  assert.match(entry.headers.get('content-type') ?? '', /javascript/);
  assert.ok(Array.isArray(await json('/api/v1/trips')), 'Vite must proxy to the compiled API');

  const trip = await json(
    '/api/v1/trips',
    'POST',
    { title: 'Synthetic web proxy smoke' },
    undefined,
    201,
  );
  const root = `/api/v1/trips/${trip.id}`;
  const day = await json(`${root}/days`, 'POST', { localDate: null }, undefined, 201);
  const timelineUrl = `${root}/days/${day.id}/timeline`;
  const visitsUrl = `${root}/days/${day.id}/visits`;
  const first = (await json(visitsUrl, 'POST', {}, undefined, 201)).visit;
  const second = (await json(visitsUrl, 'POST', {}, undefined, 201)).visit;
  const third = (await json(visitsUrl, 'POST', {}, undefined, 201)).visit;
  let timeline = await json(timelineUrl);
  assert.equal(timeline.visits.length, 3);
  assert.equal(timeline.legs.length, 2);

  await json(`${root}/days/${day.id}/reorder`, 'POST', {
    visitIds: [second.id, first.id, third.id],
  });
  timeline = await json(timelineUrl);
  assert.deepEqual(
    timeline.visits.map((visit) => visit.id),
    [second.id, first.id, third.id],
  );
  assert.equal(timeline.legs.length, 2);
  const leg = timeline.legs.find(
    (item) => item.fromVisitId === second.id && item.toVisitId === first.id,
  );
  assert.ok(leg, 'Expected stable adjacent Leg after reorder');
  await json(
    `/api/v1/legs/${leg.id}`,
    'PATCH',
    {
      transportMode: 'train',
      transportConfidence: 'confirmed',
    },
    leg.revision,
  );
  assert.equal(
    (await json(timelineUrl)).legs.find((item) => item.id === leg.id).transportMode,
    'train',
  );

  await json(`${visitsUrl}/${third.id}`, 'DELETE');
  timeline = await json(timelineUrl);
  assert.equal(timeline.visits.length, 2);
  assert.equal(timeline.legs.length, 1);
  assert.equal(timeline.legs[0].id, leg.id);
  assert.equal(timeline.legs[0].transportMode, 'train');

  const archived = await json(
    `${root}/days/${day.id}/archive`,
    'PATCH',
    {
      isArchived: true,
    },
    day.revision,
  );
  const restored = await json(
    `${root}/days/${day.id}/archive`,
    'PATCH',
    {
      isArchived: false,
    },
    archived.revision,
  );
  assert.equal(restored.isArchived, false);
  timeline = await json(timelineUrl);
  assert.equal(timeline.legs[0].id, leg.id);
  assert.equal(timeline.legs[0].transportMode, 'train');
  const explore = await json('/api/v1/explore/geojson');
  assert.equal(explore.type, 'FeatureCollection');
  assert.equal(
    explore.features.filter((feature) => feature.properties.tripId === trip.id).length,
    0,
  );

  console.log('Vite proxy + compiled API synthetic timeline journey passed.');
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null && !child.killed) {
      const done = once(child, 'exit').catch(() => undefined);
      child.kill('SIGTERM');
      await Promise.race([done, sleep(2000)]);
    }
  }
}
