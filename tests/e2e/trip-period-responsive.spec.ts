import { expect, test } from '@playwright/test';

test('Conflicting Trip periods stay readable and date controls do not overlap', async ({
  page,
  request,
}) => {
  const title = `Synthetic responsive period ${Date.now()}`;
  const tripResponse = await request.post('/api/v1/trips', { data: { title } });
  expect(tripResponse.ok(), await tripResponse.text()).toBe(true);
  const trip = (await tripResponse.json()) as { id: string; revision: number };

  const dayResponse = await request.post(`/api/v1/trips/${trip.id}/days`, {
    data: { localDate: '2026-09-12' },
  });
  expect(dayResponse.ok(), await dayResponse.text()).toBe(true);
  const day = (await dayResponse.json()) as { id: string; revision: number };

  const overrideResponse = await request.patch(`/api/v1/trips/${trip.id}`, {
    headers: { 'If-Match': `"${trip.revision}"` },
    data: { manualStartDate: '2026-09-10' },
  });
  expect(overrideResponse.ok(), await overrideResponse.text()).toBe(true);

  const dayEditResponse = await request.patch(`/api/v1/trips/${trip.id}/days/${day.id}`, {
    headers: { 'If-Match': `"${day.revision}"` },
    data: { localDate: '2026-09-01' },
  });
  expect(dayEditResponse.ok(), await dayEditResponse.text()).toBe(true);

  await page.goto('/trips');
  const card = page.locator(`.trip-card[data-trip-id="${trip.id}"]`);

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(card.locator('.trip-period')).toContainText('Period inconsistent');
    await expect(card.locator('.trip-period')).not.toContainText('2026-09-10 — 2026-09-01');
    await expect(card.locator('.trip-period-alert')).toContainText('Trip period conflict');
    await expect(card.locator('.trip-period-alert')).toHaveCSS('border-left-width', '5px');

    if (!(await card.locator('.trip-dates').evaluate((node) => node.hasAttribute('open')))) {
      await card.locator('.trip-dates summary').click();
    }
    const start = card.getByLabel('Start date override (optional)');
    const end = card.getByLabel('End date override (optional)');
    await expect(start).toHaveValue('2026-09-10');
    await expect(end).toBeVisible();
    const firstLabel = await card.locator('.trip-dates form label').nth(0).boundingBox();
    const secondLabel = await card.locator('.trip-dates form label').nth(1).boundingBox();
    expect(firstLabel).not.toBeNull();
    expect(secondLabel).not.toBeNull();
    expect(secondLabel!.y).toBeGreaterThanOrEqual(firstLabel!.y + firstLabel!.height - 2);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      elements: Array.from(document.querySelectorAll('*'))
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          right: Math.round(element.getBoundingClientRect().right),
        }))
        .filter((element) => element.right > window.innerWidth + 2)
        .slice(0, 8),
    }));
    if (overflow.elements.length) {
      console.log(`Trips overflow at ${width}px:`, overflow);
    }
    expect(overflow.documentWidth).toBeLessThanOrEqual(width + 2);
  }

  await card.getByRole('button', { name: 'Save trip dates' }).click();
  await expect(card.getByRole('alert')).toContainText([
    'Trip period conflict',
    'Trip period conflict: start cannot be after the resulting end date.',
  ]);
  await card.getByLabel('Start date override (optional)').fill('');
  await card.getByRole('button', { name: 'Save trip dates' }).click();
  await expect(card.locator('.trip-period-alert')).toHaveCount(0);
  await expect(card.locator('.trip-period')).toContainText('2026-09-01');
});
