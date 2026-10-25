import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const root = 'http://ici.localhost:8080';
const password = 'a secure pass phrase';
const email = 'owner@example.com';
const mailpit = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid response');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Missing text');
  return value;
}
async function emailLink(
  request: APIRequestContext,
  subject: string,
  target: string,
  workspace?: string,
): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const result = record(
          await (await request.get(`${mailpit}/api/v1/messages`)).json(),
        );
        const messages = result['messages'];
        if (!Array.isArray(messages)) throw new Error('Missing messages');
        for (const item of messages) {
          const message = record(item);
          if (!text(message['Subject']).includes(subject)) continue;
          const body = record(
            await (
              await request.get(
                `${mailpit}/api/v1/message/${text(message['ID'])}`,
              )
            ).json(),
          );
          if (workspace && !text(body['Text']).includes(`« ${workspace} »`))
            continue;
          const match = text(body['Text']).match(/https?:\/\/[^\s]+/);
          if (match?.[0]?.includes(target)) {
            link = match[0];
            return true;
          }
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  return link;
}
async function signup(page: Page, slug: string, secret: string) {
  await page.goto('/signup');
  await page.getByLabel('Prénom', { exact: true }).fill('Camille');
  await page.getByLabel('Nom', { exact: true }).fill('Durand');
  await page.getByLabel('Espace d’entreprise').fill(slug);
  await expect(page.getByRole('status')).toHaveText(
    'Cet espace est disponible.',
  );
  await page.getByLabel('Email professionnel').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(secret);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Vérifiez votre email' }),
  ).toBeVisible();
}
async function login(page: Page, slug: string | null, secret: string) {
  if (slug) await page.getByLabel('Espace d’entreprise').fill(slug);
  await page.getByLabel('Email professionnel').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

test('isolated tenant lifecycle with real captured email and password recovery', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120000);
  await signup(page, 'acme', password);
  let link = await emailLink(request, 'Confirmez', '/verify', 'acme');
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: 'Confirmer mon email' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Activer mon entreprise' }).click();
  await expect(
    page.getByRole('link', { name: 'Accéder à mon espace' }),
  ).toBeVisible({ timeout: 30000 });
  // Register a second tenant with the same email and a different password.
  const secondContext = await browser.newContext({ baseURL: root });
  const second = await secondContext.newPage();
  await signup(second, 'bravo', 'another secure pass phrase');
  link = await emailLink(request, 'Confirmez', '/verify', 'bravo');
  await second.goto(link);
  await second.getByRole('button', { name: 'Activer mon entreprise' }).click();
  await expect(
    second.getByRole('link', { name: 'Accéder à mon espace' }),
  ).toBeVisible({ timeout: 30000 });
  await page.goto(`${root}/login`);
  await login(page, 'acme', password);
  await expect(page).toHaveURL('http://acme.ici.localhost:8080/');
  await expect(
    page.getByRole('heading', { name: 'Bienvenue chez acme' }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === 'ici_session');
  expect(session?.domain).toBe('acme.ici.localhost');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  await second.goto('http://bravo.ici.localhost:8080/login');
  await login(second, null, password);
  await expect(second.getByRole('alert')).toHaveText(
    'Email ou mot de passe incorrect.',
  );
  await login(second, null, 'another secure pass phrase');
  await expect(
    second.getByRole('heading', { name: 'Bienvenue chez bravo' }),
  ).toBeVisible();
  // A separate browser requests a reset while the original tenant session stays open.
  const resetContext = await browser.newContext({ baseURL: root });
  const recovery = await resetContext.newPage();
  await recovery.goto('http://acme.ici.localhost:8080/forgot-password');
  await recovery.getByLabel('Email professionnel').fill(email);
  await recovery.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(recovery.getByRole('status')).toContainText(
    'Si ce compte existe',
  );
  link = await emailLink(request, 'Réinitialisez', '/reset-password');
  await recovery.goto(link);
  await recovery
    .getByLabel('Nouveau mot de passe', { exact: true })
    .fill('the new secure pass phrase');
  await recovery
    .getByRole('button', { name: 'Modifier le mot de passe' })
    .click();
  await expect(recovery.getByRole('status')).toContainText(
    'Toutes vos sessions ont été fermées',
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Connexion — acme' }),
  ).toBeVisible();
  await login(page, null, 'the new secure pass phrase');
  await expect(
    page.getByRole('heading', { name: 'Bienvenue chez acme' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(
    page.getByRole('heading', { name: 'Connexion — acme' }),
  ).toBeVisible();
  await second.reload();
  await expect(
    second.getByRole('heading', { name: 'Bienvenue chez bravo' }),
  ).toBeVisible();
  await resetContext.close();
  await secondContext.close();
});

test('public landing, legal pages and responsive layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Sachez qui est au bureau',
  );
  await expect(
    page.getByRole('heading', { name: 'Connexion', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/landing-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Email professionnel')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/landing-mobile.png',
    fullPage: true,
  });
  await page
    .getByRole('link', { name: 'Conditions d’utilisation', exact: true })
    .click();
  await expect(page.getByText(/Document provisoire/)).toBeVisible();
});

test('API and health reject forged hosts and cross-origin mutations', async ({
  request,
}) => {
  expect((await request.get('/health')).status()).toBe(200);
  const response = await request.get('/api/hello');
  expect(await response.json()).toEqual({ message: 'Hello World' });
  expect(
    (
      await request.get('/api/config', {
        headers: { Host: 'ici.localhost.evil:8080' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.get('/api/config', {
        headers: { Host: 'nested.acme.ici.localhost:8080' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { Origin: 'http://evil.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
});

test('announces an unavailable backend', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ status: 503, json: { code: 'service_unavailable' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText(
    'Le service est indisponible. Veuillez réessayer.',
  );
});
