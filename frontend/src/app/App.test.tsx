import { render, screen } from '@testing-library/react';
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
