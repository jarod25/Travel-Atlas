import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

async function seedMappedSubtrip(
  request: APIRequestContext,
  title: string,
  parentTripId: string,
  placeName: string,
  coordinates: [number, number],
) {
  const tripResponse = await request.post('/api/v1/trips', {
    data: { title, parentTripId },
  });
  expect(tripResponse.ok(), await tripResponse.text()).toBe(true);
  const trip = (await tripResponse.json()) as { id: string };

  const dayResponse = await request.post(`/api/v1/trips/${trip.id}/days`, {
    data: { localDate: '2026-09-12' },
  });
  expect(dayResponse.ok(), await dayResponse.text()).toBe(true);
  const day = (await dayResponse.json()) as { id: string };

  const placeResponse = await request.post('/api/v1/places', {
    data: { name: placeName },
  });
  expect(placeResponse.ok(), await placeResponse.text()).toBe(true);
  const place = (await placeResponse.json()) as { id: string; revision: number };

  const coordinateResponse = await request.patch(`/api/v1/places/${place.id}`, {
    headers: { 'If-Match': `"${place.revision}"` },
    data: { coordinates, confidence: 'estimated' },
  });
  expect(coordinateResponse.ok(), await coordinateResponse.text()).toBe(true);

  const visitResponse = await request.post(
    `/api/v1/trips/${trip.id}/days/${day.id}/visits`,
    { data: { placeId: place.id } },
  );
  expect(visitResponse.ok(), await visitResponse.text()).toBe(true);

  return { tripId: trip.id, dayId: day.id, title, placeName };
}

test('Switching between mapped subtrips clears stale selection and keeps map fitting available', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const parentResponse = await request.post('/api/v1/trips', {
    data: { title: `Synthetic map focus parent ${unique}` },
  });
  expect(parentResponse.ok(), await parentResponse.text()).toBe(true);
  const parent = (await parentResponse.json()) as { id: string };

  const paris = await seedMappedSubtrip(
    request,
    `Synthetic Paris ${unique}`,
    parent.id,
    `Synthetic Paris Place ${unique}`,
    [2.35, 48.85],
  );
  const tokyo = await seedMappedSubtrip(
    request,
    `Synthetic Tokyo ${unique}`,
    parent.id,
    `Synthetic Tokyo Place ${unique}`,
    [139.69, 35.68],
  );

  await page.goto(`/trips/${paris.tripId}?day=${paris.dayId}`);
  await expect(page.locator('.visit-row .visit-title')).toContainText(paris.placeName);
  await expect(page.getByRole('button', { name: 'Fit to content' })).toBeVisible();

  await page.locator('.visit-row .visit-title').click();
  await expect(page.locator('.visit-row.selected')).toHaveCount(1);

  // Navigate in the same React session: a page reload would hide the stale-selection bug.
  await page.getByLabel('Select trip').selectOption(tokyo.tripId);
  await expect(page.getByRole('heading', { name: tokyo.title })).toBeVisible();
  await expect(page.locator('.visit-row .visit-title')).toContainText(tokyo.placeName);
  await expect(page.locator('.visit-row.selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fit to content' })).toBeVisible();
});
