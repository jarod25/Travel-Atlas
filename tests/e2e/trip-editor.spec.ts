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
  await expect(page.getByText('Trip created')).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.timeline-panel')).toHaveCSS('resize', 'horizontal');

  const trips = await (await request.get('/api/v1/trips')).json();
  const trip = trips.find((item: { title: string }) => item.title === title);
  expect(trip?.id).toBeTruthy();

  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.getByText('Day created')).toBeVisible();
  // Wait for the real day tab before reading its server-side ID.
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  const dayRows = await (await request.get(`/api/v1/trips/${trip.id}/days`)).json();
  const day = dayRows[0];
  const timelineUrl = `/api/v1/trips/${trip.id}/days/${day.id}/timeline`;

  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole('button', { name: '+ Add visit' }).click();
    await expect(page.getByText('Visit added').last()).toBeVisible();
    await expect(page.locator('.visit-row')).toHaveCount(index);
  }

  await page.locator('.visit-row .visit-title').first().click();
  await expect(page.getByText('Change place', { exact: true })).toBeVisible();
  await expect(page.locator('#visit-place-search')).toBeHidden();
  await page.getByText('Change place', { exact: true }).click();
  await expect(page.locator('#visit-place-search')).toBeVisible();

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
  const editableLeg = page.locator(`.leg-pill[data-leg-id="${targetLeg.id}"]`);
  await expect(editableLeg.locator('.leg-edit')).toHaveText('Edit');
  await expect(editableLeg.locator('.leg-summary')).toContainText('Travel: Unknown');
  await editableLeg.click();
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
  const archivingVisit = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/trips/${trip.id}/days/${day.id}/visits/`) &&
      response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Archive visit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  const archivedResponse = await archivingVisit;
  expect(archivedResponse.status(), await archivedResponse.text()).toBe(200);
  await expect(page.locator('.visit-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Archive day' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Restore day' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save date' })).toBeDisabled();
  await expect(page.getByLabel("Selected day's date (optional)")).toBeDisabled();
  await expect(page.getByLabel('Search or name a Place')).toBeDisabled();
  await expect(page.locator('#place-search')).toBeDisabled();
  await page.getByRole('button', { name: 'Restore day' }).click();
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeEnabled();
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
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('Footer follows content and editor stays aligned with Explore', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/');
  const explore = await page.locator('.explore').boundingBox();
  expect(explore).not.toBeNull();

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  const footer = await page.locator('.app-footer').boundingBox();
  expect(footer).not.toBeNull();
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = page.viewportSize()!.height;
  const footerBottom = footer!.y + footer!.height;
  const expectedBottom = Math.max(documentHeight, viewportHeight);
  expect(Math.abs(footerBottom - expectedBottom)).toBeLessThanOrEqual(2);

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trip Editor' })
    .click();
  const editor = await page.locator('.editor').boundingBox();
  expect(editor).not.toBeNull();
  expect(Math.abs(editor!.x - explore!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(editor!.width - explore!.width)).toBeLessThanOrEqual(2);
});

test('Connected days expose the same editable Leg on both timelines', async ({ page, request }) => {
  const title = `Synthetic cross-day trip ${Date.now()}`;
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const trips = await (await request.get('/api/v1/trips')).json();
  const trip = trips.find((item: { title: string }) => item.title === title);
  expect(trip?.id).toBeTruthy();

  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toHaveCount(1);

  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(2);
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toHaveCount(1);

  const days = await (await request.get(`/api/v1/trips/${trip.id}/days`)).json();
  await page.locator('.day-tabs button').first().click();
  await page.getByRole('button', { name: 'Connect to next day' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Connect' }).click();
  const timelineUrl = `/api/v1/trips/${trip.id}/days/${days[0].id}/timeline`;
  await expect
    .poll(async () => {
      const timeline = await (await request.get(timelineUrl)).json();
      return timeline.crossDayLegs.length;
    })
    .toBe(1);
  const first = await (await request.get(timelineUrl)).json();
  const legId = first.crossDayLegs[0].id;
  const link = page.locator(`.cross-day-leg[data-leg-id="${legId}"]`);
  await expect(link).toContainText('To next day');
  await link.click();
  await expect(page.locator('#leg-transport')).toBeVisible();

  await page.locator('.day-tabs button').nth(1).click();
  const nextDayLink = page.locator(`.cross-day-leg[data-leg-id="${legId}"]`);
  await expect(nextDayLink).toContainText('From previous day');
});

test('Trip Editor URL survives reload and browser navigation', async ({ page, request }) => {
  const title = `Synthetic routing trip ${Date.now()}`;
  await page.goto('/explore');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const trips = await (await request.get('/api/v1/trips')).json();
  const trip = trips.find((item: { title: string }) => item.title === title);
  expect(trip?.id).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));

  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  const days = await (await request.get(`/api/v1/trips/${trip.id}/days`)).json();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}\\?day=${days[0].id}$`));

  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.day-tabs button.selected')).toHaveCount(1);

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Explore' })
    .click();
  await expect(page).toHaveURL(/\/explore(?:\?.*)?$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.day-tabs button.selected')).toHaveCount(1);
});

test('Trip renaming uses a cancellable accessible modal', async ({ page, request }) => {
  const title = `Synthetic modal trip ${Date.now()}`;
  await page.goto('/trips');
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();

  const trips = (await (await request.get('/api/v1/trips')).json()) as Array<{
    id: string;
    title: string;
  }>;
  const created = trips.find((trip) => trip.title === title);
  expect(created?.id).toBeTruthy();
  const card = page.locator(`.trip-card[data-trip-id="${created!.id}"]`);

  await card.getByRole('button', { name: 'Rename' }).click();
  const modal = page.getByRole('dialog', { name: 'Rename trip' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).not.toBeVisible();

  await card.getByRole('button', { name: 'Rename' }).click();
  await modal.getByRole('textbox', { name: 'Trip name' }).fill(title + ' renamed');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText(title + ' renamed', { exact: true })).toBeVisible();

  const updated = await (await request.get('/api/v1/trips')).json();
  expect(updated.some((trip: { title: string }) => trip.title === title + ' renamed')).toBe(true);
});

test('Add Visit reuses one field for Place lookup and explicit creation', async ({ page }) => {
  const tripTitle = `Synthetic place flow ${Date.now()}`;
  const placeName = `Synthetic Place ${Date.now()}`;
  await page.goto('/trips');
  await page.getByLabel('New trip').fill(tripTitle);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: tripTitle })).toBeVisible();
  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);

  await page.locator('#place-search').fill(placeName);
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeDisabled();
  await page.getByRole('button', { name: 'Create new Place from this name' }).click();
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeEnabled();
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toContainText(placeName);
});

test('Unknown Place stays an explicit recoverable choice after typing a name', async ({ page }) => {
  const tripTitle = `Synthetic unknown Place trip ${Date.now()}`;
  await page.goto('/trips');
  await page.getByLabel('New trip').fill(tripTitle);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: tripTitle })).toBeVisible();
  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);

  await page.locator('#place-search').fill('Unidentified stop');
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeDisabled();
  await page.getByRole('button', { name: 'Use unknown place' }).click();
  await expect(page.locator('#place-search')).toHaveValue('');
  await expect(page.getByRole('button', { name: '+ Add visit' })).toBeEnabled();
  await page.getByRole('button', { name: '+ Add visit' }).click();
  await expect(page.locator('.visit-row')).toContainText('Unknown place');
});

test('Timeline Add Visit shortcut works on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 873 });
  await page.goto('/trips');
  const title = `Synthetic long Timeline ${Date.now()}`;
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('.day-tabs button')).toHaveCount(1);
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole('button', { name: '+ Add visit' }).click();
    await expect(page.locator('.visit-row')).toHaveCount(i + 1);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Go to Add visit' }).click();
  await expect(page.locator('.composer')).toBeInViewport();
});

test('Trip period conflicts remain visible and reversible after changing a recorded day', async ({
  page,
  request,
}) => {
  const title = `Synthetic period conflict ${Date.now()}`;
  await page.goto('/trips');
  await page.getByLabel('New trip').fill(title);
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.locator('#day-date').fill('2026-09-12');
  await page.getByRole('button', { name: '+ Day' }).click();
  await expect(page.locator('#edit-day-date')).toHaveValue('2026-09-12');

  const trips = (await (await request.get('/api/v1/trips')).json()) as Array<{
    id: string;
    title: string;
  }>;
  const created = trips.find((item) => item.title === title);
  expect(created?.id).toBeTruthy();

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  const card = page.locator(`.trip-card[data-trip-id="${created!.id}"]`);
  await card.locator('summary').getByText('Edit dates', { exact: true }).click();
  await card.getByLabel('Start date override (optional)').fill('2026-09-10');
  await card.getByRole('button', { name: 'Save trip dates' }).click();
  await expect(card.locator('small')).toContainText('2026-09-10');

  await card.getByRole('button', { name: 'Open timeline' }).click();
  await page.locator('#edit-day-date').fill('2026-09-01');
  await page.getByRole('button', { name: 'Save date' }).click();

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  await expect(card.getByRole('alert')).toContainText('Trip period conflict');
  await card.locator('summary').getByText('Edit dates', { exact: true }).click();
  await card.getByLabel('Start date override (optional)').fill('');
  await card.getByRole('button', { name: 'Save trip dates' }).click();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect(card.locator('small')).toContainText('2026-09-01');
});
