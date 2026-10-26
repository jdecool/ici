import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { server } from '../test/server';
import { App } from './App';

afterEach(() => history.replaceState(null, '', '/'));
it('renders the prototype landing and accessible login', async () => {
  server.use(
    http.get('/api/config', async () => {
      await delay(30);
      return HttpResponse.json({
        root_domain: 'ici.localhost',
        public_origin: 'http://ici.localhost:5173',
        tenant: null,
        terms_version: '2026-10-draft',
      });
    }),
  );
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
  expect(
    await screen.findByRole('heading', { name: 'Connexion' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Sachez qui est au bureau',
  );
  expect(screen.getByRole('main')).toContainElement(
    screen.getByLabelText('Email professionnel'),
  );
  expect(
    screen.getByLabelText('Aperçu illustratif du planning de présence'),
  ).toHaveTextContent('Camille');
  expect(screen.getByLabelText('Ici — accueil')).toHaveAttribute('href', '/');
  expect(screen.getByRole('navigation')).toHaveAccessibleName(
    'Informations légales',
  );
});
it.each(['/terms', '/privacy'])(
  'provides provisional legal text at %s',
  (path) => {
    history.replaceState(null, '', path);
    render(<App />);
    expect(screen.getByText(/Document provisoire/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Retour à l’inscription' }),
    ).toHaveAttribute('href', '/signup');
  },
);
it('announces unknown tenant configuration failures', async () => {
  server.use(
    http.get('/api/config', () =>
      HttpResponse.json({ code: 'unknown_tenant' }, { status: 404 }),
    ),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Cet espace d’entreprise est introuvable',
  );
});
it('ignores configuration responses after unmount', async () => {
  server.use(
    http.get('/api/config', async () => {
      await delay(30);
      return HttpResponse.json({});
    }),
  );
  const view = render(<App />);
  view.unmount();
  await delay(50);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('reports invalid configuration responses', async () => {
  server.use(http.get('/api/config', () => HttpResponse.json({})));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});

it('preserves the prototype weekday and presence matrix', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: 'Connexion' });
  expect(
    screen.getAllByRole('columnheader').map((cell) => cell.textContent),
  ).toEqual(['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']);
  expect(
    screen.getAllByRole('rowheader').map((cell) => cell.textContent),
  ).toEqual(['Camille', 'Lucas', 'Inès']);
  expect(
    screen.getAllByRole('cell').map((cell) => cell.getAttribute('aria-label')),
  ).toEqual([
    'Présentiel',
    'Présentiel',
    'Distanciel',
    'Présentiel',
    'Distanciel',
    'Distanciel',
    'Présentiel',
    'Distanciel',
    'Présentiel',
    'Non renseigné',
    'Présentiel',
    'Présentiel',
    'Distanciel',
    'Présentiel',
    'Distanciel',
  ]);
});
it.each([
  ['/terms', 'Conditions d’utilisation'],
  ['/privacy', 'Politique de confidentialité'],
])('renders the legal title for %s', (path, title) => {
  history.replaceState(null, '', path);
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    title ?? '',
  );
});

it('composes the authenticated company workspace and refreshes its session after a profile edit', async () => {
  let sessions = 0;
  server.use(
    http.get('/api/config', () =>
      HttpResponse.json({
        root_domain: 'ici.localhost',
        public_origin: 'http://ici.localhost:5173',
        tenant: 'acme',
        terms_version: '2026-10-draft',
      }),
    ),
    http.get('/api/auth/session', () => {
      sessions += 1;
      return HttpResponse.json({
        id: 'owner',
        company: 'acme',
        email: 'owner@example.com',
        first_name: 'Camille',
        last_name: 'Durand',
        role: 'admin',
        csrf: 'csrf',
      });
    }),
    http.get('/api/planning/week', ({ request }) =>
      HttpResponse.json({
        start: new URL(request.url).searchParams.get('start'),
        work_days: [0, 1, 2, 3, 4],
        locations: [],
        teams: [],
        users: [],
        entries: [],
      }),
    ),
    http.get('/api/locations', () => HttpResponse.json({ locations: [] })),
    http.get('/api/teams', () => HttpResponse.json({ teams: [] })),
    http.get('/api/users', () =>
      HttpResponse.json({
        users: [
          {
            id: 'owner',
            first_name: 'Camille',
            last_name: 'Durand',
            email: 'owner@example.com',
            pending_email: null,
            role: 'admin',
            status: 'active',
            team_id: null,
            location_id: null,
          },
        ],
      }),
    ),
    http.patch('/api/users/owner', () => HttpResponse.json({ updated: true })),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'acme' });
  expect(screen.getByRole('main')).toHaveClass('workspace-main');
  expect(
    screen.getByLabelText('Espace entreprise', { selector: 'section' })
      .parentElement,
  ).toHaveClass('workspace-container');
  expect(
    screen.queryByText('Sachez qui est au bureau avant de vous déplacer.'),
  ).not.toBeInTheDocument();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.click(screen.getByRole('button', { name: 'Lieux' }));
  await screen.findByText('Aucun lieu. Ajoutez un premier lieu de présence.');
  fireEvent.click(screen.getByRole('button', { name: 'Utilisateurs' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Modifier Camille Durand' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(sessions).toBe(2));
  server.use(
    http.post('/api/auth/logout', ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf');
      return HttpResponse.json({ logged_out: true });
    }),
  );
  server.use(
    http.post('/api/auth/logout', () =>
      HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Vous n’avez pas les droits nécessaires.',
  );
  server.use(
    http.post('/api/auth/logout', () =>
      HttpResponse.json({ logged_out: true }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  await screen.findByRole('heading', { name: 'Connexion — acme' });
});

it('keeps tenant login in the public form layout', async () => {
  history.replaceState(null, '', '/login');
  server.use(
    http.get('/api/config', () =>
      HttpResponse.json({
        root_domain: 'ici.localhost',
        public_origin: 'http://ici.localhost:5173',
        tenant: 'acme',
        terms_version: '2026-10-draft',
      }),
    ),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Connexion — acme' });
  expect(screen.getByRole('main')).toHaveClass('landing');
  expect(
    screen
      .getByRole('heading', { name: 'Connexion — acme' })
      .closest('.form-column'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Sachez qui est au bureau avant de vous déplacer.',
  );
});
