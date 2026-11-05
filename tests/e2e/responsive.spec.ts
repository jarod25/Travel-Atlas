import { test, expect } from '@playwright/test';

const viewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 899, height: 700 },
  { width: 901, height: 700 },
  { width: 1366, height: 768 },
  { width: 1700, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`Explore and Trip Editor stay usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/explore');
    await expect(page.getByRole('heading', { name: 'Explore the atlas' })).toBeVisible();
    await expect(page.getByLabel('Filter map by trip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      )
      .toBe(true);

    await page.getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Trip Editor' }).click();
    await expect(page.getByRole('heading', { name: 'Recently modified trips' })).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      )
      .toBe(true);
  });
}
