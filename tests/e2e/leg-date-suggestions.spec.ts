import { test, expect } from '@playwright/test';

test('Leg date suggestions remain unpersisted until explicitly saved', async ({
  page,
  request,
}) => {
  const title = `Synthetic dated Leg ${Date.now()}`;
  await page.goto('/trips');
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  const trips = await (await request.get('/api/v1/trips')).json();
  const trip = trips.find((item: { title: string }) => item.title === title);
  expect(trip?.id).toBeTruthy();

  await page.getByLabel('Add day (optional date)').fill('2026-09-12');
  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toHaveCount(2);

  const days = await (await request.get(`/api/v1/trips/${trip.id}/days`)).json();
  const timelineUrl = `/api/v1/trips/${trip.id}/days/${days[0].id}/timeline`;
  const before = await (await request.get(timelineUrl)).json();
  expect(before.legs[0].departureLocalDate).toBeNull();
  expect(before.legs[0].arrivalLocalDate).toBeNull();

  await page.locator('.leg-pill').first().click();
  await page.locator('.time-details summary').click();
  await expect(page.getByLabel('Departure date')).toHaveValue('2026-09-12');
  await expect(page.getByLabel('Arrival date')).toHaveValue('2026-09-12');

  const after = await (await request.get(timelineUrl)).json();
  expect(after.legs[0].departureLocalDate).toBeNull();
  expect(after.legs[0].arrivalLocalDate).toBeNull();
});
