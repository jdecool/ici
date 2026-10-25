import { expect, test } from '@playwright/test';

test('displays the real backend greeting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Hello World',
  );
});

test('serves the greeting API contract', async ({ request }) => {
  const response = await request.get('/api/hello');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toEqual({ message: 'Hello World' });
});

test('serves the health contract', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('rejects unsupported methods and unknown API routes', async ({
  request,
}) => {
  expect((await request.post('/api/hello')).status()).toBe(405);
  expect((await request.get('/api/missing')).status()).toBe(404);
});

test('announces an unavailable backend', async ({ page }) => {
  await page.route('**/api/hello', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Unable to load greeting.');
});
