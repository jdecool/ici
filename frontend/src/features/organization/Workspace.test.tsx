import { StrictMode } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { Workspace } from './Workspace';
import type { Location, Member, Team } from './api';
const session = {
  id: 'owner',
  company: 'Acme',
  first_name: 'Camille',
  last_name: 'Durand',
  role: 'admin',
  csrf: 'csrf-token',
};
let locations: Location[];
let teams: Team[];
let users: Member[];
const refresh = vi.fn();
const logout = vi.fn();
beforeEach(() => {
  refresh.mockClear();
  logout.mockClear();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  locations = [
    {
      id: 'paris',
      name: 'Paris',
      code: 'PAR',
      city: 'Paris',
      address: '12 rue de Paris',
      members: 1,
    },
    {
      id: 'bordeaux',
      name: 'Bordeaux',
      code: 'BDX',
      city: '',
      address: '',
      members: 0,
    },
  ];
  teams = [
    { id: 'engineering', name: 'Engineering', members: 1 },
    { id: 'product', name: 'Product', members: 0 },
  ];
  users = [
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
    {
      id: 'alice',
      first_name: 'Alice',
      last_name: 'Martin',
      email: 'alice@example.com',
      pending_email: 'new@example.com',
      role: 'collaborator',
      status: 'pending',
      team_id: 'engineering',
      location_id: 'paris',
    },
  ];
  server.use(
    http.get('/api/planning/week', ({ request }) =>
      HttpResponse.json({
        start: new URL(request.url).searchParams.get('start'),
        work_days: [0, 1, 2, 3, 4],
        locations,
        teams,
        users: users.filter((u) => u.status === 'active'),
        entries: [],
      }),
    ),
    http.get('/api/locations', () => HttpResponse.json({ locations })),
    http.get('/api/teams', () => HttpResponse.json({ teams })),
    http.get('/api/users', () => HttpResponse.json({ users })),
  );
});
afterEach(() => vi.restoreAllMocks());
function mount(role = 'admin') {
  const result = render(
    <Workspace
      session={{ ...session, role }}
      logout={logout}
      logoutBusy={false}
      refreshSession={refresh}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lieux' }));
  return result;
}
function change(label: string, value: string) {
  fireEvent.change(
    within(screen.queryByRole('dialog') ?? document.body).getByLabelText(label),
    { target: { value } },
  );
}
function submit(name: string) {
  const form = screen.getByRole('button', { name }).closest('form');
  if (!form) throw new Error('Missing form');
  expect(fireEvent.submit(form)).toBe(false);
}
it('shows locations, restricts collaborator navigation and logs out', async () => {
  mount('collaborator');
  expect(screen.getByRole('status')).toHaveTextContent('Chargement');
  await screen.findByRole('heading', { name: 'Paris' });
  expect(screen.getByText('12 rue de Paris')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Ajouter un lieu' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Entreprise' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Utilisateurs' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(logout).toHaveBeenCalledOnce();
  expect(
    screen.getByText('Bonjour Camille Durand · Collaborateur'),
  ).toBeVisible();
  expect(screen.queryByText(/Suppression impossible/)).not.toBeInTheDocument();
});
it('creates and updates a location, validates errors, cancels then confirms deletion', async () => {
  server.use(
    http.post('/api/locations', async ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf-token');
      expect(await request.json()).toEqual({
        name: 'Lyon',
        code: 'LYO',
        city: 'Lyon',
        address: '1 rue Centrale',
      });
      locations.push({
        id: 'lyon',
        name: 'Lyon',
        code: 'LYO',
        city: 'Lyon',
        address: '1 rue Centrale',
        members: 0,
      });
      return HttpResponse.json({ id: 'lyon' });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  expect(
    screen.getByRole('button', { name: 'Supprimer Paris' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un lieu' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  change('Nom du lieu', 'Lyon');
  change('Code', 'LYO');
  change('Ville', 'Lyon');
  change('Adresse', '1 rue Centrale');
  submit('Créer');
  await screen.findByRole('heading', { name: 'Lyon' });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Modification enregistrée.',
  );
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Lyon' }));
  expect(screen.getByLabelText('Code')).toHaveValue('LYO');
  server.use(
    http.patch('/api/locations/lyon', () =>
      HttpResponse.json(
        { code: 'invalid_input', fields: { code: 'invalid' } },
        { status: 422 },
      ),
    ),
  );
  submit('Enregistrer');
  expect(await screen.findByRole('alert')).toHaveTextContent('Vérifiez');
  expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
  server.use(
    http.patch('/api/locations/lyon', async ({ request }) => {
      expect(await request.json()).toMatchObject({ name: 'Lyon Centre' });
      locations = locations.map((item) =>
        item.id === 'lyon' ? { ...item, name: 'Lyon Centre' } : item,
      );
      return HttpResponse.json({ updated: true });
    }),
  );
  change('Nom du lieu', 'Lyon Centre');
  submit('Enregistrer');
  await screen.findByRole('heading', { name: 'Lyon Centre' });
  await screen.findByRole('article', { name: 'Occupation Lyon Centre' });
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Supprimer Lyon Centre' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  server.use(
    http.delete('/api/locations/lyon', () => {
      locations = locations.filter((item) => item.id !== 'lyon');
      return HttpResponse.json({ deleted: true });
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Supprimer Lyon Centre' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Lyon Centre' }),
    ).not.toBeInTheDocument(),
  );
});
it('manages teams and moves members through both controls', async () => {
  server.use(
    http.post('/api/teams', async ({ request }) => {
      expect(await request.json()).toEqual({ name: 'Marketing' });
      teams.push({ id: 'marketing', name: 'Marketing', members: 0 });
      return HttpResponse.json({ id: 'marketing' });
    }),
    http.patch('/api/teams/product', () => {
      teams = teams.map((team) =>
        team.id === 'product' ? { ...team, name: 'Design' } : team,
      );
      return HttpResponse.json({ updated: true });
    }),
    http.delete('/api/teams/marketing', () => {
      teams = teams.filter((team) => team.id !== 'marketing');
      return HttpResponse.json({ deleted: true });
    }),
    http.patch('/api/users/alice', async ({ request }) => {
      const body: unknown = await request.json();
      expect(body).toMatchObject({
        team_id: 'product',
        email: 'new@example.com',
      });
      users = users.map((user) =>
        user.id === 'alice' ? { ...user, team_id: 'product' } : user,
      );
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
  expect(
    screen.getByRole('button', { name: 'Supprimer l’équipe' }),
  ).toBeDisabled();
  change('Équipe de Alice Martin', 'product');
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Équipe de Alice Martin'),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Product · 0 membre(s)' }),
  );
  expect(screen.getByLabelText('Équipe de Alice Martin')).toHaveValue(
    'product',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Modifier l’équipe' }));
  change('Nom de l’équipe', 'Design');
  submit('Enregistrer');
  await screen.findByRole('heading', { name: 'Design' });
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle équipe' }));
  change('Nom de l’équipe', 'Marketing');
  submit('Créer');
  fireEvent.click(
    await screen.findByRole('button', { name: 'Marketing · 0 membre(s)' }),
  );
  expect(
    screen.getByText('Aucun membre dans cette équipe pour l’instant.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Inviter un membre' }));
  expect(screen.getByLabelText('Équipe', { selector: 'select' })).toHaveValue(
    'marketing',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’équipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Marketing · 0 membre(s)' }),
    ).not.toBeInTheDocument(),
  );
});
it('invites users, filters them, resends invitations and edits existing profiles', async () => {
  server.use(
    http.post('/api/users', async ({ request }) => {
      expect(await request.json()).toEqual({
        first_name: 'Bob',
        last_name: 'Petit',
        email: 'bob@example.com',
        role: 'collaborator',
        team_id: null,
        location_id: null,
      });
      users.push({
        id: 'bob',
        first_name: 'Bob',
        last_name: 'Petit',
        email: 'bob@example.com',
        pending_email: null,
        role: 'collaborator',
        status: 'pending',
        team_id: null,
        location_id: null,
      });
      return HttpResponse.json({ id: 'bob' });
    }),
    http.post('/api/users/bob/invitation', () =>
      HttpResponse.json({ sent: true }),
    ),
    http.patch('/api/users/alice', async ({ request }) => {
      expect(await request.json()).toMatchObject({
        email: 'new@example.com',
        team_id: 'product',
        location_id: 'bordeaux',
        role: 'admin',
      });
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Utilisateurs' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Ajouter un utilisateur' }),
  );
  change('Prénom', 'Bob');
  change('Nom', 'Petit');
  change('Email professionnel', 'bob@example.com');
  submit('Envoyer l’invitation');
  await screen.findByRole('heading', { name: 'Bob Petit' });
  expect(refresh).not.toHaveBeenCalled();
  change('Rechercher', 'BOB');
  expect(
    screen.queryByRole('heading', { name: 'Alice Martin' }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Renvoyer l’invitation' }),
  );
  await screen.findByText('Modification enregistrée.');
  change('Statut', 'inactive');
  expect(
    screen.getByText('Aucun utilisateur ne correspond à ces critères.'),
  ).toBeVisible();
  change('Statut', '');
  change('Rechercher', '');
  change('Équipe', 'engineering');
  expect(
    screen.queryByRole('heading', { name: 'Bob Petit' }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Modifier Alice Martin' }),
  );
  expect(screen.getByLabelText('Email professionnel')).toHaveValue(
    'new@example.com',
  );
  change('Équipe', 'product');
  change('Lieu habituel', 'bordeaux');
  change('Rôle', 'admin');
  submit('Enregistrer');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Modification enregistrée.',
  );
  change('Équipe', 'none');
  expect(screen.getByRole('heading', { name: 'Camille Durand' })).toBeVisible();
});
it('confirms status changes, reports failures and refreshes a changed current account', async () => {
  let fail = true;
  server.use(
    http.patch('/api/users/owner', async ({ request }) => {
      expect(await request.json()).toMatchObject({ status: 'inactive' });
      if (fail)
        return HttpResponse.json(
          { code: 'last_administrator' },
          { status: 409 },
        );
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Utilisateurs' }));
  const owner = screen
    .getByRole('heading', { name: 'Camille Durand' })
    .closest('article');
  if (!owner) throw new Error('owner');
  fireEvent.click(within(owner).getByRole('button', { name: 'Désactiver' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'au moins un administrateur',
  );
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
it('handles empty lists, failed loads, malformed payloads and retry', async () => {
  server.use(
    http.get('/api/locations', () => HttpResponse.json({ locations: [{}] })),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('indisponible');
  locations = [];
  teams = [];
  users = [];
  server.use(
    http.get('/api/locations', () => HttpResponse.json({ locations })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByText('Aucun lieu. Ajoutez un premier lieu de présence.');
  fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
  expect(
    screen.getByText(
      'Aucune équipe. Créez-en une pour y rattacher des collaborateurs.',
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Lieux' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un lieu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('ignores obsolete loads under StrictMode', async () => {
  let calls = 0;
  server.use(
    http.get('/api/locations', async () => {
      calls += 1;
      if (calls === 1) {
        await delay(80);
        return HttpResponse.json({
          locations: [{ ...locations[0], name: 'Obsolete' }],
        });
      }
      return HttpResponse.json({ locations });
    }),
  );
  render(
    <StrictMode>
      <Workspace
        session={{ ...session, role: 'collaborator' }}
        logout={logout}
        logoutBusy
        refreshSession={refresh}
      />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lieux' }));
  await screen.findByRole('heading', { name: 'Paris' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(
    screen.queryByRole('heading', { name: 'Obsolete' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Déconnexion…' })).toBeDisabled();
});

it('presents complete organization details, current navigation and accurate team membership controls', async () => {
  server.use(
    http.patch('/api/users/owner', async ({ request }) => {
      expect(await request.json()).toEqual({
        ...users[0],
        team_id: 'engineering',
        email: 'owner@example.com',
      });
      users = users.map((user) =>
        user.id === 'owner' ? { ...user, team_id: 'engineering' } : user,
      );
      teams = teams.map((team) => ({
        ...team,
        members: users.filter((user) => user.team_id === team.id).length,
      }));
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  expect(
    screen.getByText('Bonjour Camille Durand · Administrateur'),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const navigation = screen.getByRole('navigation', {
    name: 'Espace entreprise',
  });
  expect(
    within(navigation).getByRole('button', { name: 'Lieux' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    within(navigation).getByRole('button', { name: 'Entreprise' }),
  ).not.toHaveAttribute('aria-current');
  expect(
    within(navigation).getByRole('button', { name: 'Utilisateurs' }),
  ).not.toHaveAttribute('aria-current');
  const paris = screen
    .getByRole('heading', { name: 'Paris' })
    .closest('article');
  const bordeaux = screen
    .getByRole('heading', { name: 'Bordeaux' })
    .closest('article');
  if (!paris || !bordeaux) throw new Error('locations');
  expect(
    within(paris).getByText(
      'Suppression impossible : des collaborateurs y sont rattachés.',
    ),
  ).toBeVisible();
  expect(
    within(bordeaux).queryByText(/Suppression impossible/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer Bordeaux' }));
  expect(
    screen.getByRole('alertdialog', {
      name: 'Supprimer le lieu « Bordeaux » ?',
    }),
  ).toBeVisible();
  expect(
    fireEvent(
      screen.getByRole('alertdialog'),
      new Event('cancel', { cancelable: true }),
    ),
  ).toBe(false);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
  expect(
    screen.queryByRole('heading', { name: 'Lieux de travail' }),
  ).not.toBeInTheDocument();
  expect(
    within(navigation).getByRole('button', { name: 'Entreprise' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    within(navigation).getByRole('button', { name: 'Lieux' }),
  ).not.toHaveAttribute('aria-current');
  expect(
    screen.getByText('2 équipe(s) · 2 utilisateur(s) · 2 lieu(x)'),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Engineering · 1 membre(s)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('button', { name: 'Product · 0 membre(s)' }),
  ).toHaveAttribute('aria-pressed', 'false');
  const panel = screen.getByRole('region', { name: 'Équipe Engineering' });
  expect(within(panel).getByText('1 membre(s) · 0 actif(s)')).toBeVisible();
  expect(
    within(panel).getByText('alice@example.com · Invitation en attente'),
  ).toBeVisible();
  expect(
    within(panel).getByText(
      'La suppression nécessite de déplacer tous les membres.',
    ),
  ).toBeVisible();
  const move = screen.getByLabelText('Déplacer un membre vers cette équipe');
  expect(
    within(move)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Choisir un collaborateur…', 'Camille Durand']);
  let reportedErrors = 0;
  function handleError(event: ErrorEvent) {
    reportedErrors += 1;
    event.preventDefault();
  }
  window.addEventListener('error', handleError);
  try {
    fireEvent.change(move, { target: { value: '' } });
    expect(reportedErrors).toBe(0);
  } finally {
    window.removeEventListener('error', handleError);
  }
  fireEvent.change(move, { target: { value: 'owner' } });
  await screen.findByText('2 membre(s) · 1 actif(s)');
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Modifier Alice Martin' }),
  );
  expect(
    screen.getByRole('dialog', { name: 'Modifier l’utilisateur' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Product · 0 membre(s)' }),
  );
  expect(
    screen.queryByText(
      'La suppression nécessite de déplacer tous les membres.',
    ),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’équipe' }));
  expect(
    screen.getByRole('alertdialog', {
      name: 'Supprimer l’équipe « Product » ?',
    }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
});
it('shows profile roles, pending emails, statuses and assignments and reactivates another user', async () => {
  users = users.map((user) =>
    user.id === 'alice' ? { ...user, status: 'inactive' } : user,
  );
  server.use(
    http.patch('/api/users/alice', async ({ request }) => {
      await delay(50);
      expect(await request.json()).toMatchObject({
        status: 'active',
        email: 'new@example.com',
      });
      users = users.map((user) =>
        user.id === 'alice' ? { ...user, status: 'active' } : user,
      );
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Utilisateurs' }));
  expect(
    screen
      .getByRole('navigation', { name: 'Espace entreprise' })
      .querySelector('[aria-current="page"]'),
  ).toHaveTextContent('Utilisateurs');
  const alice = screen
    .getByRole('heading', { name: 'Alice Martin' })
    .closest('article');
  const owner = screen
    .getByRole('heading', { name: 'Camille Durand' })
    .closest('article');
  if (!alice || !owner) throw new Error('accounts');
  expect(within(alice).getByText('Collaborateur · Désactivé')).toBeVisible();
  expect(within(owner).getByText('Administrateur · Actif')).toBeVisible();
  expect(within(alice).getByText('Engineering · Paris')).toBeVisible();
  expect(
    within(owner).getByText('Sans équipe · Sans lieu habituel'),
  ).toBeVisible();
  expect(
    within(alice).getByText('Confirmation en attente : new@example.com'),
  ).toBeVisible();
  expect(
    within(owner).queryByText(/Confirmation en attente/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Renvoyer l’invitation' }),
  ).not.toBeInTheDocument();
  expect(
    within(alice).getByRole('button', { name: 'Modifier Alice Martin' })
      .textContent,
  ).toBe('Modifier Alice Martin');
  fireEvent.click(within(alice).getByRole('button', { name: 'Réactiver' }));
  expect(
    screen.getByRole('alertdialog', { name: 'Réactiver Alice Martin ?' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(
    await screen.findByRole('button', { name: 'Enregistrement…' }),
  ).toBeDisabled();
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  );
  await screen.findByText('Collaborateur · Actif');
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Modification enregistrée.',
  );
  fireEvent.click(within(alice).getByRole('button', { name: 'Désactiver' }));
  expect(
    screen.getByRole('alertdialog', { name: 'Désactiver Alice Martin ?' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  change('Statut', 'active');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  change('Équipe', 'none');
  expect(
    screen.queryByRole('heading', { name: 'Alice Martin' }),
  ).not.toBeInTheDocument();
});

it('explains an empty collaborator view', async () => {
  locations = [];
  mount('collaborator');
  expect(
    await screen.findByText(
      'Aucun lieu. Votre administrateur peut définir les lieux de présence.',
    ),
  ).toBeVisible();
});
it('ignores obsolete loading errors and supports a company with users but no teams', async () => {
  let calls = 0;
  teams = [];
  server.use(
    http.get('/api/locations', async () => {
      calls += 1;
      if (calls === 1) {
        await delay(50);
        return HttpResponse.error();
      }
      return HttpResponse.json({ locations });
    }),
  );
  render(
    <StrictMode>
      <Workspace
        session={session}
        logout={logout}
        logoutBusy={false}
        refreshSession={refresh}
      />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lieux' }));
  await screen.findByRole('heading', { name: 'Paris' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
  expect(
    screen.getByText(
      'Aucune équipe. Créez-en une pour y rattacher des collaborateurs.',
    ),
  ).toBeVisible();
});

it('resends an invitation and clears notices and errors while a request is pending', async () => {
  let sends = 0;
  server.use(
    http.post('/api/users/alice/invitation', async () => {
      sends += 1;
      await delay(80);
      return sends === 1
        ? HttpResponse.json({ sent: true })
        : HttpResponse.json({ code: 'rate_limited' }, { status: 429 });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Utilisateurs' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Renvoyer l’invitation' }),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Renvoyer l’invitation' }),
  ).toBeDisabled();
  await screen.findByText('Modification enregistrée.');
  await waitFor(() => expect(sends).toBe(1));
  fireEvent.click(
    screen.getByRole('button', { name: 'Renvoyer l’invitation' }),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Trop de tentatives.',
  );
  expect(sends).toBe(2);
});

it('moves the selected collaborator rather than the first available account', async () => {
  let moves = 0;
  server.use(
    http.patch('/api/users/alice', async ({ request }) => {
      expect(await request.json()).toMatchObject({
        id: 'alice',
        team_id: 'product',
        email: 'new@example.com',
      });
      moves += 1;
      users = users.map((user) =>
        user.id === 'alice' ? { ...user, team_id: 'product' } : user,
      );
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Product · 0 membre(s)' }),
  );
  fireEvent.change(
    screen.getByLabelText('Déplacer un membre vers cette équipe'),
    { target: { value: 'alice' } },
  );
  await waitFor(() => expect(moves).toBe(1));
  const edit = await screen.findByRole('button', {
    name: 'Modifier Alice Martin',
  });
  expect(edit.textContent).toBe('Modifier Alice Martin');
  expect(screen.getByLabelText('Équipe de Alice Martin')).toHaveValue(
    'product',
  );
});

it('keeps resource identifiers independent when saving a location matching the current user ID', async () => {
  locations = locations.map((location) =>
    location.id === 'paris' ? { ...location, id: session.id } : location,
  );
  server.use(
    http.patch('/api/locations/owner', () =>
      HttpResponse.json({ updated: true }),
    ),
  );
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Paris' }));
  submit('Enregistrer');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(refresh).not.toHaveBeenCalled();
});
it('opens planning by default and navigates personal presence and administrator configuration', async () => {
  server.use(
    http.get('/api/planning/template', () =>
      HttpResponse.json({ entries: [] }),
    ),
  );
  render(
    <Workspace
      session={session}
      logout={logout}
      logoutBusy={false}
      refreshSession={refresh}
    />,
  );
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  const navigation = screen.getByRole('navigation', {
    name: 'Espace entreprise',
  });
  expect(
    within(navigation).getByRole('button', { name: 'Planning' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    within(navigation).getByRole('button', { name: 'Ma semaine' }),
  ).not.toHaveAttribute('aria-current');
  expect(
    within(navigation).getByRole('button', { name: 'Configuration' }),
  ).not.toHaveAttribute('aria-current');
  fireEvent.click(
    within(navigation).getByRole('button', { name: 'Ma semaine' }),
  );
  await screen.findByRole('heading', { name: 'Ma semaine' });
  expect(
    within(navigation).getByRole('button', { name: 'Ma semaine' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    within(navigation).getByRole('button', { name: 'Planning' }),
  ).not.toHaveAttribute('aria-current');
  fireEvent.click(within(navigation).getByRole('button', { name: 'Planning' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Renseigner ma semaine' }),
  );
  await screen.findByRole('heading', { name: 'Ma semaine' });
  fireEvent.click(
    within(navigation).getByRole('button', { name: 'Configuration' }),
  );
  await screen.findByRole('heading', { name: 'Configuration' });
  expect(
    within(navigation).getByRole('button', { name: 'Configuration' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    within(navigation).getByRole('button', { name: 'Ma semaine' }),
  ).not.toHaveAttribute('aria-current');
  expect(screen.getAllByRole('checkbox')).toHaveLength(7);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Planning' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  expect(
    within(navigation).getByRole('button', { name: 'Configuration' }),
  ).not.toHaveAttribute('aria-current');
});
it('restricts configuration navigation for collaborators', async () => {
  mount('collaborator');
  await screen.findByRole('heading', { name: 'Paris' });
  expect(
    screen.queryByRole('button', { name: 'Configuration' }),
  ).not.toBeInTheDocument();
});
it('does not mount planning on company or user administration pages', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  for (const tab of ['Entreprise', 'Utilisateurs']) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    expect(screen.getByRole('heading', { name: tab })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Configuration' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Présences' }),
    ).not.toBeInTheDocument();
  }
});
