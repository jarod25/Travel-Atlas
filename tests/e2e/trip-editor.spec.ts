import { test, expect } from '@playwright/test';

test('Trip Editor preserves a recorded Leg across reorder and archive/restore', async ({
  page,
  request,
}) => {
  const title = `Synthetic browser trip ${Date.now()}`;
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', {
      name: 'Trips',
    })
    .click();
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.timeline-panel')).toHaveCSS('resize', 'horizontal');

  const trips = await (await request.get('/api/v1/trips')).json();
  const trip = trips.find((item: { title: string }) => item.title === title);
  expect(trip?.id).toBeTruthy();

  await page.getByRole('button', { name: '+ Day' }).click();
  // Wait for the real day tab before reading its server-side ID.
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  const dayRows = await (await request.get(`/api/v1/trips/${trip.id}/days`)).json();
  const day = dayRows[0];
  const timelineUrl = `/api/v1/trips/${trip.id}/days/${day.id}/timeline`;

  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole('button', { name: '+ Add visit' }).click();
    await expect(page.locator('.visit-row')).toHaveCount(index);
  }

  const before = await (await request.get(timelineUrl)).json();
  const [first, second, third] = before.visits;
  await page.getByRole('button', { name: 'Move visit 2 up' }).click();
  await expect
    .poll(async () => {
      const timeline = await (await request.get(timelineUrl)).json();
      return timeline.visits.map((item: { id: string }) => item.id);
    })
    .toEqual([second.id, first.id, third.id]);

  await expect(page.locator('.visit-row').first()).toHaveAttribute('data-visit-id', second.id);
  const beforeEdit = await (await request.get(timelineUrl)).json();
  const targetLeg = beforeEdit.legs.find(
    (item: { fromVisitId: string; toVisitId: string }) =>
      item.fromVisitId === second.id && item.toVisitId === first.id,
  );
  expect(targetLeg?.id).toBeTruthy();
  await page.locator(`.leg-pill[data-leg-id="${targetLeg.id}"]`).click();
  await expect(page.locator('#leg-transport')).toBeVisible();
  await page.locator('#leg-transport').selectOption('train');
  await page.locator('#leg-confidence').selectOption('confirmed');
  await expect(page.locator('#leg-transport')).toHaveValue('train');
  const saving = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/legs/${targetLeg.id}`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save Leg' }).click();
  const savedResponse = await saving;
  expect(savedResponse.status(), await savedResponse.text()).toBe(200);

  await expect
    .poll(async () => {
      const timeline = await (await request.get(timelineUrl)).json();
      return timeline.legs.find(
        (item: { fromVisitId: string; toVisitId: string }) =>
          item.fromVisitId === second.id && item.toVisitId === first.id,
      )?.transportMode;
    })
    .toBe('train');
  const reordered = await (await request.get(timelineUrl)).json();
  const savedLeg = reordered.legs.find(
    (item: { fromVisitId: string; toVisitId: string }) =>
      item.fromVisitId === second.id && item.toVisitId === first.id,
  );
  expect(savedLeg?.transportConfidence).toBe('confirmed');

  await page.locator('.visit-row .visit-title').last().click();
  page.once('dialog', (dialog) => dialog.accept());
  const archivingVisit = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/trips/${trip.id}/days/${day.id}/visits/`) &&
      response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Archive visit' }).click();
  const archivedResponse = await archivingVisit;
  expect(archivedResponse.status(), await archivedResponse.text()).toBe(200);
  await expect(page.locator('.visit-row')).toHaveCount(2);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Archive day' }).click();
  await expect(page.getByRole('button', { name: 'Restore day' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore day' }).click();
  await expect(page.locator('.visit-row')).toHaveCount(2);

  const after = await (await request.get(timelineUrl)).json();
  const restored = after.legs.find((leg: { id: string }) => leg.id === savedLeg.id);
  expect(restored?.transportMode).toBe('train');
  expect(restored?.transportConfidence).toBe('confirmed');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Map of selected trip and its saved geometry' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.visit-row')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
