import { test, expect } from '@playwright/test';

test('Explore filters survive reload and browser navigation', async ({ page }) => {
  await page.goto('/explore');
  await page.locator('#explore-from').fill('2026-09-12');
  await page.locator('#explore-to').fill('2026-09-15');
  await page.locator('#explore-transport').selectOption('train');
  await page.locator('#explore-certainty').selectOption('estimated');

  await expect(page).toHaveURL(/from=2026-09-12/);
  await expect(page).toHaveURL(/to=2026-09-15/);
  await expect(page).toHaveURL(/transport=train/);
  await expect(page).toHaveURL(/certainty=estimated/);

  await page.reload();
  await expect(page.locator('#explore-from')).toHaveValue('2026-09-12');
  await expect(page.locator('#explore-to')).toHaveValue('2026-09-15');
  await expect(page.locator('#explore-transport')).toHaveValue('train');
  await expect(page.locator('#explore-certainty')).toHaveValue('estimated');

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips' })
    .click();
  await page.goBack();
  await expect(page.locator('#explore-from')).toHaveValue('2026-09-12');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('#explore-from')).toHaveValue('');
  await expect(page.locator('#explore-certainty')).toHaveValue('all');
  await expect(page).not.toHaveURL(/from=2026-09-12/);
});
