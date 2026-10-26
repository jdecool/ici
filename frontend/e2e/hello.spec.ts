import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const root = 'http://ici.localhost:8080';
const password = 'A secure pass phrase1!';
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
  await signup(second, 'bravo', 'Another secure pass phrase1!');
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
    page.getByRole('heading', { name: 'acme', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Planning de l’équipe' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cette semaine' }).click();
  await expect(
    page.getByRole('heading', { name: 'Planning de l’équipe' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Lieux', exact: true }).click();
  // Manage the organization and activate an invited collaborator through real SMTP.
  await page.getByRole('button', { name: 'Ajouter un lieu' }).click();
  await page.getByLabel('Nom du lieu').fill('Paris Centre');
  await page.getByLabel('Code', { exact: true }).fill('PAR');
  await page.getByLabel('Ville', { exact: true }).fill('Paris');
  await page.getByLabel('Adresse', { exact: true }).fill('12 rue de Paris');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Paris Centre' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Entreprise', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle équipe' }).click();
  await page.getByLabel('Nom de l’équipe').fill('Engineering');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Engineering', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Inviter un membre' }).click();
  await page.getByLabel('Prénom', { exact: true }).fill('Alice');
  await page.getByLabel('Nom', { exact: true }).fill('Martin');
  await page.getByLabel('Email professionnel').fill('alice@example.com');
  await page
    .getByLabel('Lieu habituel')
    .selectOption({ label: 'Paris Centre' });
  await page.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const invitedContext = await browser.newContext({ baseURL: root });
  const invited = await invitedContext.newPage();
  await invited.goto(
    await emailLink(request, 'Invitation', '/accept-invitation'),
  );
  await invited.getByLabel('Mot de passe', { exact: true }).fill(password);
  await invited.getByRole('checkbox').check();
  await invited.getByRole('button', { name: 'Activer mon compte' }).click();
  await invited.getByRole('link', { name: 'Se connecter' }).click();
  await invited.getByLabel('Email professionnel').fill('alice@example.com');
  await invited.getByLabel('Mot de passe', { exact: true }).fill(password);
  await invited
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  await expect(
    invited.getByRole('heading', { name: 'Planning de l’équipe' }),
  ).toBeVisible();
  await invited.getByRole('button', { name: 'Lieux', exact: true }).click();
  await expect(
    invited.getByRole('heading', { name: 'Paris Centre' }),
  ).toBeVisible();
  await expect(
    invited.getByRole('button', { name: 'Utilisateurs' }),
  ).toHaveCount(0);
  await expect(
    invited.getByRole('button', { name: 'Ajouter un lieu' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Configuration', exact: true })
    .click();
  await page.getByRole('button', { name: '7 j / 7', exact: true }).click();
  await expect(
    page.getByText('7 jour(s) affiché(s)', { exact: false }),
  ).toBeVisible();
  await invited
    .getByRole('button', { name: 'Ma semaine', exact: true })
    .click();
  const template = invited.getByRole('region', { name: 'Semaine type' });
  const monday = template.getByRole('group', { name: 'Lundi' });
  await monday
    .getByRole('combobox', { name: 'Matin', exact: true })
    .selectOption({ label: 'Présentiel · Paris Centre' });
  await expect(
    template.getByRole('button', { name: 'Appliquer sur 4 semaines' }),
  ).toBeEnabled();
  await template
    .getByRole('button', { name: 'Appliquer sur 4 semaines' })
    .click();
  await expect(invited.getByText('Modification enregistrée.')).toBeVisible();
  await invited.reload();
  await invited
    .getByRole('button', { name: 'Ma semaine', exact: true })
    .click();
  await expect(
    invited.getByRole('region', { name: 'Mes présences' }).getByRole('button', {
      name: 'Matin : Présentiel · Paris Centre',
      exact: true,
    }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Lieux', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Occupation Paris Centre' })
      .getByText('Alice Martin', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Planning', exact: true }).click();
  await page
    .getByRole('button', {
      name: /Alice Martin · .* · Matin : Présentiel · Paris Centre/,
    })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  const firstSlot = page.getByRole('button', {
    name: /Alice Martin · .* · Matin : Présentiel · Paris Centre/,
  });
  const lastSlot = page
    .getByRole('button', {
      name: /Alice Martin · .* · Après-midi : Non renseigné/,
    })
    .nth(1);
  await firstSlot.hover();
  await page.mouse.down();
  await lastSlot.hover();
  await page.mouse.up();
  await expect(page.getByLabel('Modifier la sélection')).toContainText(
    '4 demi-journée(s)',
  );
  await firstSlot.focus();
  await firstSlot.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Matin ≠ après-midi', exact: true })
    .uncheck();
  await page
    .getByRole('combobox', { name: 'Journée entière', exact: true })
    .selectOption('remote');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Lieux', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Occupation Paris Centre' })
      .getByText('Aucune présence renseignée.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Utilisateurs' }).click();
  await page.getByRole('button', { name: 'Modifier Alice Martin' }).click();
  await page.getByLabel('Email professionnel').fill('alice.new@example.com');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(
    page.getByText('Confirmation en attente : alice.new@example.com'),
  ).toBeVisible();
  await invited.goto(
    await emailLink(request, 'nouvelle adresse', '/confirm-email'),
  );
  await invited.getByRole('button', { name: 'Confirmer mon adresse' }).click();
  await expect(invited.getByRole('status')).toContainText('Reconnectez-vous');
  await page.reload();
  await page.getByRole('button', { name: 'Utilisateurs' }).click();
  const alice = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Alice Martin' }) });
  await expect(
    alice.getByText('alice.new@example.com', { exact: true }),
  ).toBeVisible();
  await alice.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(alice.getByText('Collaborateur · Désactivé')).toBeVisible();
  await invited.goto('http://acme.ici.localhost:8080/login');
  await invited.getByLabel('Email professionnel').fill('alice.new@example.com');
  await invited.getByLabel('Mot de passe', { exact: true }).fill(password);
  await invited
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  await expect(invited.getByRole('alert')).toContainText(
    'Email ou mot de passe incorrect',
  );
  await alice.getByRole('button', { name: 'Réactiver' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(alice.getByText('Collaborateur · Actif')).toBeVisible();
  await page.screenshot({
    path: 'test-results/workspace-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/workspace-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await invitedContext.close();
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
  await login(second, null, 'Another secure pass phrase1!');
  await expect(
    second.getByRole('heading', { name: 'bravo', exact: true }),
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
    .fill('The New secure pass phrase1!1!');
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
  await login(page, null, 'The New secure pass phrase1!1!');
  await expect(
    page.getByRole('heading', { name: 'acme', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(
    page.getByRole('heading', { name: 'Connexion — acme' }),
  ).toBeVisible();
  await second.reload();
  await expect(
    second.getByRole('heading', { name: 'bravo', exact: true }),
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
