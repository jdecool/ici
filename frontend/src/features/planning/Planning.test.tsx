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
import { Planning } from './Planning';
import type { PlanningView } from './Planning';
import type { Entry, TemplateEntry, Week } from './model';
import { currentWeek, add, formatted } from './model';
const session = { id: 'me', role: 'admin', csrf: 'csrf' };
let week: Week;
let template: TemplateEntry[];
let submitted: unknown;
const browserErrors: string[] = [];
function captureBrowserError(event: ErrorEvent) {
  browserErrors.push(event.message);
  event.preventDefault();
}
afterEach(() => {
  window.removeEventListener('error', captureBrowserError, true);
  expect(browserErrors).toEqual([]);
});
function mount(view: PlanningView = 'planning', role = 'admin') {
  return render(
    <StrictMode>
      <Planning
        view={view}
        session={{ ...session, role }}
        goMe={vi.fn()}
        renderLocation={(id) => <h3>{id}</h3>}
      />
    </StrictMode>,
  );
}
beforeEach(() => {
  browserErrors.length = 0;
  window.addEventListener('error', captureBrowserError, true);
  submitted = undefined;
  template = [];
  week = {
    start: currentWeek(),
    work_days: [0, 1, 2, 3, 4],
    users: [
      {
        id: 'me',
        first_name: 'Camille',
        last_name: 'Durand',
        team_id: null,
        location_id: 'paris',
      },
      {
        id: 'alice',
        first_name: 'Alice',
        last_name: 'Martin',
        team_id: 'team',
        location_id: 'paris',
      },
    ],
    locations: [{ id: 'paris', name: 'Paris', code: 'PAR', city: 'Paris' }],
    teams: [{ id: 'team', name: 'Produit' }],
    entries: [],
  };
  server.use(
    http.get('/api/planning/week', ({ request }) =>
      HttpResponse.json({
        ...week,
        start: new URL(request.url).searchParams.get('start'),
      }),
    ),
    http.get('/api/planning/template', () =>
      HttpResponse.json({ entries: template }),
    ),
    http.put('/api/planning/settings', async ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf');
      const data: unknown = await request.json();
      submitted = data;
      return HttpResponse.json({ updated: true });
    }),
    http.put('/api/planning/entries', async ({ request }) => {
      const body: unknown = await request.json();
      submitted = body;
      return HttpResponse.json({ updated: true });
    }),
    http.put('/api/planning/template', async ({ request }) => {
      const body: unknown = await request.json();
      submitted = body;
      return HttpResponse.json({ updated: true });
    }),
    http.post('/api/planning/template/apply', async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ updated: true });
    }),
  );
});
it('groups team members and unassigned users, filters, and navigates weeks', async () => {
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Chargement');
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  expect(
    screen.getByRole('columnheader', { name: 'Sans équipe' }),
  ).toBeVisible();
  expect(screen.getByText(/10 demi-journée/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Rechercher un collaborateur'), {
    target: { value: 'álîce' },
  });
  expect(screen.getByRole('rowheader', { name: 'Alice Martin' })).toBeVisible();
  expect(
    screen.queryByRole('rowheader', { name: /Camille/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Équipe'), {
    target: { value: 'none' },
  });
  expect(
    screen.getByText('Aucun collaborateur ne correspond à ces critères.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
});
it('edits split days and notes, copies the morning and clears the day', async () => {
  mount();
  const button = (
    await screen.findAllByRole('button', {
      name: /Camille Durand · .* · Matin : Non renseigné/,
    })
  )[0];
  if (!button) throw new Error('missing morning');
  fireEvent.click(button);
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.change(within(dialog).getByLabelText('Matin'), {
    target: { value: 'office:paris' },
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Copier le matin' }),
  );
  expect(within(dialog).getByLabelText('Après-midi')).toHaveValue(
    'office:paris',
  );
  fireEvent.change(within(dialog).getByLabelText('Après-midi'), {
    target: { value: 'remote' },
  });
  fireEvent.change(within(dialog).getByLabelText('Note'), {
    target: { value: 'Client' },
  });
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Enregistrer' })
      .closest('form') ?? dialog,
  );
  await waitFor(() => {
    expect(submitted).toMatchObject({
      user_id: 'me',
      entries: [
        { half: 'am', status: 'office', location_id: 'paris', note: 'Client' },
        { half: 'pm', status: 'remote', location_id: null, note: 'Client' },
      ],
    });
  });
  await screen.findByRole('status');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  fireEvent.click(
    screen.getAllByRole('button', {
      name: /Camille Durand · .* · Matin : Non renseigné/,
    })[0] ?? button,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la journée' }));
  await waitFor(() => {
    expect(submitted).toMatchObject({
      entries: [{ status: 'none' }, { status: 'none' }],
    });
  });
});
it('makes colleagues read only for collaborators', async () => {
  mount('planning', 'collaborator');
  const buttons = await screen.findAllByRole('button', {
    name: /Alice Martin · .* · Matin : Non renseigné/,
  });
  fireEvent.click(buttons[0] ?? document.body);
  expect(screen.getByText('Consultation uniquement')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Enregistrer' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('selects a range with the keyboard and writes it atomically', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  fireEvent.keyDown(cells[0] ?? document.body, { key: ' ', shiftKey: true });
  fireEvent.keyDown(cells[3] ?? document.body, { key: ' ', shiftKey: true });
  const bar = screen.getByLabelText('Modifier la sélection');
  expect(bar).toHaveTextContent('4 demi-journée(s)');
  fireEvent.click(within(bar).getByRole('button', { name: 'Distanciel' }));
  await waitFor(() => {
    expect(submitted).toMatchObject({
      user_id: 'me',
      entries: Array.from({ length: 4 }, () => ({ status: 'remote' })),
    });
  });
});
it('selects by pointer and cancels with Escape', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  fireEvent.pointerDown(cells[0] ?? document.body, {
    button: 0,
    pointerType: 'mouse',
  });
  fireEvent.pointerEnter(cells[2] ?? document.body);
  fireEvent.pointerUp(window);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
});
it('saves displayed days and restricts the last remaining day', async () => {
  week.work_days = [0];
  mount('config');
  await screen.findByRole('heading', {
    name: 'Jours affichés dans le planning',
  });
  expect(screen.getByLabelText('Lundi')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '7 j / 7' }));
  await waitFor(() => {
    expect(submitted).toEqual({ work_days: [0, 1, 2, 3, 4, 5, 6] });
  });
});
it('edits and applies a personal template to four weeks without confirmation', async () => {
  mount('me');
  const section = await screen.findByRole('region', { name: 'Semaine type' });
  await within(section).findAllByRole('combobox');
  const monday = within(section).getByRole('group', { name: 'Lundi' });
  fireEvent.change(within(monday).getByLabelText('Matin'), {
    target: { value: 'office:paris' },
  });
  await waitFor(() => {
    expect(submitted).toMatchObject({
      entries: [
        { weekday: 0, half: 'am', status: 'office', location_id: 'paris' },
      ],
    });
  });
  await waitFor(() => {
    expect(
      within(section).getByRole('button', { name: 'Appliquer sur 4 semaines' }),
    ).toBeEnabled();
  });
  fireEvent.click(
    within(section).getByRole('button', { name: 'Appliquer sur 4 semaines' }),
  );
  await waitFor(() => {
    expect(submitted).toEqual({ start: currentWeek(), weeks: 4 });
  });
});
it('shows occupancy counts, charts and unique people', async () => {
  week.entries = [
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'pm',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
  ] satisfies Entry[];
  mount('locations');
  const card = await screen.findByRole('article', { name: 'Occupation Paris' });
  expect(within(card).getByText('Camille Durand')).toBeVisible();
  expect(within(card).getAllByRole('listitem')).toHaveLength(1);
  expect(
    within(card).getByLabelText('Occupation hebdomadaire Paris'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Mardi/ }));
  expect(within(card).getByText('Aucune présence renseignée.')).toBeVisible();
});
it('reports load and mutation errors and allows retry', async () => {
  server.use(
    http.get('/api/planning/week', () =>
      HttpResponse.json({ code: 'unavailable' }, { status: 503 }),
    ),
  );
  mount();
  await screen.findByRole('alert');
  server.use(http.get('/api/planning/week', () => HttpResponse.json(week)));
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  const buttons = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  fireEvent.click(buttons[0] ?? document.body);
  server.use(
    http.put('/api/planning/entries', () =>
      HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la journée' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('droits');
});
it('ignores a previous week response after navigation', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  server.use(
    http.get('/api/planning/week', async ({ request }) => {
      const start = new URL(request.url).searchParams.get('start');
      await delay(start === add(currentWeek(), 7) ? 50 : 0);
      return HttpResponse.json({ ...week, start });
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.click(screen.getByRole('button', { name: 'Semaine précédente' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
});
it('opens a clicked cell when the pointer re-enters the same slot', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Alice Martin · .* · Matin : Non renseigné/,
  });
  const button = cells[0];
  if (!button) throw new Error('Missing morning');
  fireEvent(
    button,
    new MouseEvent('pointerdown', { button: 0, bubbles: true }),
  );
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.pointerEnter(button);
  fireEvent.pointerUp(window);
  fireEvent.click(button, { detail: 1 });
  expect(screen.getByRole('dialog')).toBeVisible();
});
it.each([
  ['Bureau · Paris', 'office', 'paris'],
  ['Déplacement', 'travel', null],
  ['Absent', 'off', null],
  ['Effacer', 'none', null],
])(
  'applies %s to an inclusive reversed selection',
  async (label, status, location) => {
    mount();
    const cells = await screen.findAllByRole('button', {
      name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
    });
    const first = cells[3];
    const last = cells[0];
    if (!first || !last) throw new Error('Missing slots');
    fireEvent.keyDown(first, { key: ' ', shiftKey: true });
    fireEvent.keyDown(last, { key: ' ', shiftKey: true });
    const bar = screen.getByLabelText('Modifier la sélection');
    fireEvent.click(within(bar).getByRole('button', { name: label }));
    await waitFor(() => {
      expect(submitted).toEqual({
        user_id: 'me',
        entries: [
          {
            date: currentWeek(),
            half: 'am',
            status,
            location_id: location,
            note: '',
          },
          {
            date: currentWeek(),
            half: 'pm',
            status,
            location_id: location,
            note: '',
          },
          {
            date: add(currentWeek(), 1),
            half: 'am',
            status,
            location_id: location,
            note: '',
          },
          {
            date: add(currentWeek(), 1),
            half: 'pm',
            status,
            location_id: location,
            note: '',
          },
        ],
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByLabelText('Modifier la sélection'),
      ).not.toBeInTheDocument();
    });
  },
);
it('drags within one user and cancels a committed selection', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = cells[0];
  const last = cells[2];
  if (!first || !last) throw new Error('Missing slots');
  fireEvent(first, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.pointerEnter(last);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '3 demi-journée(s)',
  );
  fireEvent.pointerUp(window);
  fireEvent.click(last, { detail: 1 });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler la sélection' }));
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
});
it('updates individual displayed days without altering the other days', async () => {
  mount('config');
  const saturday = await screen.findByLabelText('Samedi');
  fireEvent.click(saturday);
  await waitFor(() => {
    expect(submitted).toEqual({ work_days: [0, 1, 2, 3, 4, 5] });
  });
  await screen.findByLabelText('Lundi');
  fireEvent.click(screen.getByLabelText('Lundi'));
  await waitFor(() => {
    expect(submitted).toEqual({ work_days: [1, 2, 3, 4] });
  });
});
it('switches the mobile presence groups by half and day and opens colleague details', async () => {
  week.entries = [
    {
      user_id: 'alice',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: 'Client',
    },
    {
      user_id: 'alice',
      date: currentWeek(),
      half: 'pm',
      status: 'travel',
      location_id: null,
      note: 'Train',
    },
  ];
  mount('planning', 'collaborator');
  await screen.findByText('Bureau · Paris · 1');
  fireEvent.click(
    screen.getByRole('button', { name: 'Après-midi', hidden: true }),
  );
  expect(screen.getByText('Déplacement · 1')).toBeInTheDocument();
  fireEvent.click(
    screen.getByText('Alice Martin Train', { selector: 'button' }),
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Consultation uniquement',
  );
  expect(screen.getByRole('dialog')).toHaveTextContent('Client');
});
it('presents the complete presence legend and seven configurable weekday labels', async () => {
  const view = mount();
  const legend = await screen.findByRole('list');
  expect(
    within(legend)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'Présentiel',
    'Distanciel',
    'Déplacement',
    'Absent',
    'Non renseigné',
  ]);
  view.unmount();
  mount('config');
  await screen.findByLabelText('Lundi');
  for (const label of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'])
    expect(screen.getByLabelText(label)).toBeChecked();
  for (const label of ['Samedi', 'Dimanche'])
    expect(screen.getByLabelText(label)).not.toBeChecked();
});
it('groups and sorts team members with the connected user first', async () => {
  week.users = [
    {
      id: 'zoe',
      first_name: 'Zoé',
      last_name: 'Zulu',
      team_id: 'team',
      location_id: null,
    },
    {
      id: 'alice',
      first_name: 'Alice',
      last_name: 'Martin',
      team_id: 'team',
      location_id: null,
    },
    {
      id: 'me',
      first_name: 'Camille',
      last_name: 'Zzz',
      team_id: 'team',
      location_id: null,
    },
    {
      id: 'aline',
      first_name: 'Aline',
      last_name: 'Albert',
      team_id: 'team',
      location_id: null,
    },
    {
      id: 'guest',
      first_name: 'Guest',
      last_name: 'Member',
      team_id: null,
      location_id: null,
    },
  ];
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  expect(
    screen.getAllByRole('rowheader').map((cell) => cell.textContent),
  ).toEqual([
    'Camille Zzz (vous)',
    'Aline Albert',
    'Alice Martin',
    'Zoé Zulu',
    'Guest Member',
  ]);
  expect(screen.getByRole('columnheader', { name: 'Produit' })).toHaveAttribute(
    'colspan',
    '6',
  );
  fireEvent.change(screen.getByLabelText('Équipe'), {
    target: { value: 'team' },
  });
  expect(
    screen.queryByRole('rowheader', { name: 'Guest Member' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('columnheader', { name: 'Sans équipe' }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole('rowheader')).toHaveLength(4);
});
it('highlights the selected office, counts morning attendance and exposes presence notes', async () => {
  week.locations.push({ id: 'lyon', name: 'Lyon', city: 'Lyon', code: 'LYO' });
  week.users.push({
    id: 'bob',
    first_name: 'Bob',
    last_name: 'Member',
    team_id: null,
    location_id: null,
  });
  week.entries = [
    {
      user_id: 'bob',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
    {
      user_id: 'alice',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: 'Client visit',
    },
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'lyon',
      note: '',
    },
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'pm',
      status: 'remote',
      location_id: null,
      note: '',
    },
  ];
  mount();
  await screen.findByRole('columnheader', {
    name: /Lundi .* 3 sur site le matin/,
  });
  const paris = screen.getByRole('button', {
    name: /Alice Martin · .* · Matin : Présentiel · Paris/,
  });
  const lyon = screen.getByRole('button', {
    name: /Camille Durand · .* · Matin : Présentiel · Lyon/,
  });
  const remote = screen.getByRole('button', {
    name: /Camille Durand · .* · Après-midi : Distanciel/,
  });
  expect(paris).toHaveTextContent('PAR');
  expect(lyon).toHaveTextContent('LYO');
  expect(paris).toHaveClass('presence', 'presence-office');
  expect(remote).toHaveClass('presence', 'presence-remote');
  expect(paris).toHaveAttribute('title', 'Client visit');
  expect(within(paris).getByLabelText('Note')).toHaveTextContent('•');
  expect(remote).toHaveAttribute('title', 'Distanciel');
  expect(remote).toHaveTextContent('Distanciel');
  expect(within(remote).queryByLabelText('Note')).not.toBeInTheDocument();
  expect(lyon).toHaveStyle({ opacity: '1' });
  fireEvent.change(screen.getByLabelText('Lieu'), {
    target: { value: 'paris' },
  });
  expect(
    screen.getByRole('columnheader', { name: /Lundi .* 2 sur site le matin/ }),
  ).toBeVisible();
  expect(paris).toHaveStyle({ opacity: '1' });
  expect(lyon).toHaveStyle({ opacity: '0.35' });
  expect(remote).toHaveStyle({ opacity: '0.35' });
  fireEvent.change(screen.getByLabelText('Lieu'), { target: { value: '' } });
  expect(lyon).toHaveStyle({ opacity: '1' });
  fireEvent.click(paris);
  expect(screen.getByLabelText('Matin')).toHaveValue('office:paris');
  expect(screen.getByLabelText('Après-midi')).toHaveValue('none');
  expect(within(screen.getByRole('dialog')).getByLabelText('Note')).toHaveValue(
    'Client visit',
  );
});
it('navigates the exact displayed date range and returns to the current week', async () => {
  const range = (start: string) =>
    `${formatted(start)} – ${formatted(add(start, 4))}`;
  mount();
  await screen.findByText(range(currentWeek()), { exact: true });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Semaine précédente' }));
  await screen.findByText(range(add(currentWeek(), -7)), { exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByText(range(currentWeek()), { exact: true });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByText(range(add(currentWeek(), 7)), { exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
  await screen.findByText(range(currentWeek()), { exact: true });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it.each([
  ['Lun – Ven', [0, 1, 2, 3, 4]],
  ['Lun – Sam', [0, 1, 2, 3, 4, 5]],
  ['Mar – Sam', [1, 2, 3, 4, 5]],
])(
  'saves the %s preset and exposes the current preset state',
  async (label, workDays) => {
    mount('config');
    await screen.findByLabelText('Lundi');
    expect(screen.getByRole('button', { name: 'Lun – Ven' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '7 j / 7' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByText(
        '5 jour(s) affiché(s) : Lundi, Mardi, Mercredi, Jeudi, Vendredi.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Semaine précédente' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => {
      expect(submitted).toEqual({ work_days: workDays });
    });
  },
);
it('clears selection and the open editor when changing views', async () => {
  const root = (view: PlanningView) => (
    <StrictMode>
      <Planning view={view} session={session} goMe={vi.fn()} />
    </StrictMode>
  );
  const mounted = render(root('planning'));
  const buttons = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const button = buttons[0];
  if (!button) throw new Error('Missing slot');
  fireEvent.keyDown(button, { key: ' ', shiftKey: true });
  expect(screen.getByLabelText('Modifier la sélection')).toBeVisible();
  mounted.rerender(root('config'));
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  mounted.rerender(root('planning'));
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole('button', { name: /Camille Durand · .* · Matin/ })[0] ??
      document.body,
  );
  expect(screen.getByRole('dialog')).toBeVisible();
  mounted.rerender(root('config'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  mounted.rerender(root('planning'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('uses the connected account for personal shortcuts and detailed editing', async () => {
  week.users.reverse();
  mount('me');
  const buttons = await screen.findAllByRole('button', {
    name: 'Matin : Non renseigné',
  });
  fireEvent.click(buttons[0] ?? document.body);
  expect(screen.getByRole('dialog')).toHaveAccessibleName(
    `Camille Durand · ${formatted(currentWeek())}`,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Distanciel' })[0] ?? document.body,
  );
  await waitFor(() => {
    expect(submitted).toEqual({
      user_id: 'me',
      entries: [
        {
          date: currentWeek(),
          half: 'am',
          status: 'remote',
          location_id: null,
          note: '',
        },
        {
          date: currentWeek(),
          half: 'pm',
          status: 'remote',
          location_id: null,
          note: '',
        },
      ],
    });
  });
});
it('marks only the inclusive range on the selected person and handles keyboard cancellation', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = cells[1];
  const last = cells[3];
  if (!first || !last) throw new Error('Missing slots');
  expect(fireEvent.keyDown(first, { key: ' ', shiftKey: true })).toBe(false);
  fireEvent.keyDown(last, { key: ' ', shiftKey: true });
  for (const [i, cell] of cells.entries()) {
    expect(cell).toHaveAttribute(
      'aria-pressed',
      i >= 1 && i <= 3 ? 'true' : 'false',
    );
    expect(cell).toHaveClass('presence', 'presence-none');
    expect(cell).toHaveTextContent('Non renseigné');
    if (i >= 1 && i <= 3) expect(cell).toHaveClass('presence-selected');
    else expect(cell).not.toHaveClass('presence-selected');
  }
  for (const cell of screen.getAllByRole('button', {
    name: /Alice Martin · .* · (Matin|Après-midi) : Non renseigné/,
  }))
    expect(cell).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(window, { key: 'x' });
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '3 demi-journée(s) · Camille',
  );
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(first, { key: 'x', shiftKey: true });
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(first, { key: ' ' });
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
});
it('extends shift-clicks only within the same person and resets on another person', async () => {
  mount();
  const own = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const other = screen.getAllByRole('button', {
    name: /Alice Martin · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = own[1];
  const last = own[4];
  const colleague = other[4];
  if (!first || !last || !colleague) throw new Error('Missing slots');
  fireEvent.click(first, { shiftKey: true });
  fireEvent.click(last, { shiftKey: true });
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '4 demi-journée(s) · Camille',
  );
  fireEvent.click(colleague, { shiftKey: true });
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '1 demi-journée(s) · Alice',
  );
});
it('ignores touch and non-primary drags and stops extending after release', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = cells[0];
  const next = cells[2];
  const after = cells[4];
  if (!first || !next || !after) throw new Error('Missing slots');
  const touch = new MouseEvent('pointerdown', { button: 0, bubbles: true });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  fireEvent(first, touch);
  fireEvent.pointerEnter(next);
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent(first, new MouseEvent('pointerdown', { button: 2, bubbles: true }));
  fireEvent.pointerEnter(next);
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent(first, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  fireEvent.pointerEnter(next);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '3 demi-journée(s)',
  );
  fireEvent.pointerUp(window);
  fireEvent.pointerEnter(after);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '3 demi-journée(s)',
  );
});
it('denies bulk editing colleagues for collaborators', async () => {
  mount('planning', 'collaborator');
  const cells = await screen.findAllByRole('button', {
    name: /Alice Martin · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = cells[0];
  const last = cells[3];
  if (!first || !last) throw new Error('Missing slots');
  fireEvent(first, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  fireEvent.pointerEnter(last);
  fireEvent.pointerUp(window);
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(first, { key: ' ', shiftKey: true });
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.click(first, { shiftKey: true });
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Consultation uniquement',
  );
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
});
it('opens a keyboard-activated cell after a drag that produced no click', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi) : Non renseigné/,
  });
  const first = cells[0];
  const last = cells[2];
  if (!first || !last) throw new Error('Missing slots');
  fireEvent(first, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  fireEvent.pointerEnter(last);
  fireEvent.pointerUp(window);
  fireEvent.click(last, { detail: 0 });
  expect(screen.getByRole('dialog')).toBeVisible();
});
it('blocks edits during bulk writes, reports errors and clears them on retry', async () => {
  let attempts = 0;
  server.use(
    http.put('/api/planning/entries', async () => {
      attempts += 1;
      await delay(70);
      return attempts === 1
        ? HttpResponse.json({ code: 'forbidden' }, { status: 403 })
        : HttpResponse.json({ updated: true });
    }),
  );
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const first = cells[0];
  if (!first) throw new Error('Missing slot');
  fireEvent.keyDown(first, { key: ' ', shiftKey: true });
  const bar = screen.getByLabelText('Modifier la sélection');
  fireEvent.click(within(bar).getByRole('button', { name: 'Distanciel' }));
  expect(
    within(bar).getByRole('button', { name: 'Distanciel' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Semaine suivante' }),
  ).toBeDisabled();
  expect(first).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Alice Martin', { selector: 'button' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('droits');
  expect(within(bar).getByRole('button', { name: 'Distanciel' })).toBeEnabled();
  fireEvent.click(within(bar).getByRole('button', { name: 'Distanciel' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByText('Modification enregistrée.');
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  expect(
    screen.queryByText('Modification enregistrée.'),
  ).not.toBeInTheDocument();
});
it('shows a loading state during a refresh and replaces obsolete displayed data', async () => {
  let refreshing = false;
  server.use(
    http.get('/api/planning/week', async ({ request }) => {
      if (refreshing) await delay(70);
      return HttpResponse.json({
        ...week,
        start: new URL(request.url).searchParams.get('start'),
        users: week.users.map((u) =>
          refreshing && u.id === 'alice' ? { ...u, last_name: 'Updated' } : u,
        ),
      });
    }),
  );
  server.use(
    http.put('/api/planning/entries', () => {
      refreshing = true;
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const first = cells[0];
  if (!first) throw new Error('Missing slot');
  fireEvent.click(first);
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la journée' }));
  await screen.findByText('Chargement du planning…');
  expect(
    screen.queryByRole('rowheader', { name: 'Alice Martin' }),
  ).not.toBeInTheDocument();
  await screen.findByRole('rowheader', { name: 'Alice Updated' });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Modification enregistrée.',
  );
});
it('ignores obsolete StrictMode data and errors and cleans up window listeners', async () => {
  let calls = 0;
  server.use(
    http.get('/api/planning/week', async () => {
      calls += 1;
      if (calls === 1) {
        await delay(60);
        return HttpResponse.json({ ...week, users: [] });
      }
      return HttpResponse.json(week);
    }),
  );
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const view = mount();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByRole('rowheader', { name: /Camille Durand/ });
  await delay(100);
  expect(
    screen.getByRole('rowheader', { name: /Camille Durand/ }),
  ).toBeVisible();
  view.unmount();
  for (const [name, handler] of added.mock.calls)
    if (name === 'pointerup' || name === 'keydown')
      expect(removed).toHaveBeenCalledWith(name, handler);
  added.mockRestore();
  removed.mockRestore();
  calls = 0;
  server.use(
    http.get('/api/planning/week', async () => {
      calls += 1;
      if (calls === 1) {
        await delay(60);
        return HttpResponse.error();
      }
      return HttpResponse.json(week);
    }),
  );
  mount();
  await screen.findByRole('rowheader', { name: /Camille Durand/ });
  await delay(100);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('keeps an unavailable office label readable when a response references a missing location', async () => {
  week.entries = [
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'missing',
      note: '',
    },
  ];
  mount();
  const button = await screen.findByRole('button', {
    name: /Camille Durand · .* · Matin : Présentiel · Lieu indisponible/,
  });
  expect(button).toHaveAttribute('title', 'Présentiel · Lieu indisponible');
});
it('uses configured non-Monday days consistently across headers, navigation and selection', async () => {
  week.work_days = [2, 4];
  week.entries = [2, 4].flatMap((day) =>
    (['am', 'pm'] as const).map((half) => ({
      user_id: 'me',
      date: add(currentWeek(), day),
      half,
      status: 'office' as const,
      location_id: 'paris',
      note: '',
    })),
  );
  const view = mount();
  await screen.findByRole('region', { name: 'Présences' });
  expect(
    screen.getByText(
      `${formatted(add(currentWeek(), 2))} – ${formatted(add(currentWeek(), 4))}`,
      { exact: true },
    ),
  ).toBeVisible();
  const wednesday = new Date(`${add(currentWeek(), 2)}T12:00:00`).getDate();
  const friday = new Date(`${add(currentWeek(), 4)}T12:00:00`).getDate();
  expect(
    screen.getByRole('columnheader', {
      name: `Mercredi ${wednesday} 1 sur site le matin`,
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Renseigner ma semaine' }),
  ).not.toBeInTheDocument();
  const dayButtons = screen.getByLabelText('Jour affiché');
  const wed = within(dayButtons).getByRole('button', {
    name: `Mercredi ${wednesday}`,
  });
  const fri = within(dayButtons).getByRole('button', {
    name: `Vendredi ${friday}`,
  });
  expect(wed).toHaveAttribute('aria-pressed', 'true');
  expect(fri).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(fri);
  expect(wed).toHaveAttribute('aria-pressed', 'false');
  expect(fri).toHaveAttribute('aria-pressed', 'true');
  const am = screen.getByRole('button', { name: 'Matin' });
  const pm = screen.getByRole('button', { name: 'Après-midi' });
  expect(am).toHaveAttribute('aria-pressed', 'true');
  expect(pm).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(pm);
  expect(am).toHaveAttribute('aria-pressed', 'false');
  expect(pm).toHaveAttribute('aria-pressed', 'true');
  for (const [i, status] of [
    'office',
    'remote',
    'travel',
    'off',
    'none',
  ].entries())
    expect(screen.getAllByRole('listitem')[i]).toHaveClass(
      `presence-${status}`,
    );
  view.unmount();
  mount('locations');
  await screen.findByRole('article', { name: 'Occupation Paris' });
  expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Matin' }),
  ).not.toBeInTheDocument();
});
it('filters unassigned users and named teams independently of search', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.change(screen.getByLabelText('Équipe'), {
    target: { value: 'none' },
  });
  expect(
    screen.getByRole('rowheader', { name: 'Camille Durand (vous)' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('rowheader', { name: 'Alice Martin' }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Équipe'), {
    target: { value: 'team' },
  });
  expect(screen.getByRole('rowheader', { name: 'Alice Martin' })).toBeVisible();
  expect(
    screen.queryByRole('rowheader', { name: 'Camille Durand (vous)' }),
  ).not.toBeInTheDocument();
});
it('does not display planning-only controls in personal or configuration views', async () => {
  const view = mount('me');
  await screen.findByRole('heading', { name: 'Ma semaine' });
  expect(screen.queryByLabelText('Jour affiché')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Rechercher un collaborateur'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Jours affichés dans le planning' }),
  ).not.toBeInTheDocument();
  view.unmount();
  mount('config', 'collaborator');
  await screen.findByRole('region', { name: 'Configuration' });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jour affiché')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Semaine précédente' }),
  ).not.toBeInTheDocument();
});
it('refreshes the current week even when it is already selected', async () => {
  let changed = false;
  server.use(
    http.get('/api/planning/week', () =>
      HttpResponse.json({
        ...week,
        users: week.users.map((user) =>
          changed && user.id === 'alice'
            ? { ...user, last_name: 'Updated' }
            : user,
        ),
      }),
    ),
  );
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  changed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
  await screen.findByRole('rowheader', { name: 'Alice Updated' });
});
it('allows collaborators to edit and bulk-fill their own presence', async () => {
  mount('planning', 'collaborator');
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const first = cells[0];
  if (!first) throw new Error('Missing slot');
  fireEvent.click(first);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
  expect(screen.queryByText('Consultation uniquement')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la journée' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  const fresh = (
    await screen.findAllByRole('button', {
      name: /Camille Durand · .* · Matin/,
    })
  )[0];
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  if (!fresh) throw new Error('Missing refreshed slot');
  fireEvent.keyDown(fresh, { key: ' ', shiftKey: true });
  fireEvent.click(
    within(screen.getByLabelText('Modifier la sélection')).getByRole('button', {
      name: 'Distanciel',
    }),
  );
  await waitFor(() => {
    expect(submitted).toEqual({
      user_id: 'me',
      entries: [
        {
          date: currentWeek(),
          half: 'am',
          status: 'remote',
          location_id: null,
          note: '',
        },
      ],
    });
  });
});
it('does not render empty mobile status groups', async () => {
  mount();
  await screen.findByText('Non renseigné · 2');
  expect(screen.queryByText('Bureau · Paris · 0')).not.toBeInTheDocument();
  expect(screen.queryByText('Distanciel · 0')).not.toBeInTheDocument();
  expect(screen.queryByText('Déplacement · 0')).not.toBeInTheDocument();
  expect(screen.queryByText('Absent · 0')).not.toBeInTheDocument();
});
it('recovers a failed refresh of the same week without trapping the loading state', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const first = cells[0];
  if (!first) throw new Error('Missing slot');
  server.use(
    http.put('/api/planning/entries', () =>
      HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
    ),
  );
  fireEvent.keyDown(first, { key: ' ', shiftKey: true });
  fireEvent.click(
    within(screen.getByLabelText('Modifier la sélection')).getByRole('button', {
      name: 'Distanciel',
    }),
  );
  await screen.findByRole('alert');
  server.use(
    http.get('/api/planning/week', () =>
      HttpResponse.json({ code: 'unavailable' }, { status: 503 }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  expect(screen.getByRole('alert')).toHaveTextContent('indisponible');
});
it('hides old dates after failed navigation and retries the requested week', async () => {
  let fail = true;
  server.use(
    http.get('/api/planning/week', ({ request }) => {
      const start = new URL(request.url).searchParams.get('start');
      return start !== currentWeek() && fail
        ? HttpResponse.json({ code: 'unavailable' }, { status: 503 })
        : HttpResponse.json({ ...week, start });
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('heading', { name: 'Planning de l’équipe' }),
  ).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByText(
    `${formatted(add(currentWeek(), 7))} – ${formatted(add(currentWeek(), 11))}`,
    { exact: true },
  );
});
it('preserves pointer shift anchors and starts a fresh range without Shift', async () => {
  mount();
  const own = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi)/,
  });
  const other = screen.getAllByRole('button', {
    name: /Alice Martin · .* · (Matin|Après-midi)/,
  });
  const first = own[1];
  const end = own[4];
  const next = own[5];
  const colleague = other[4];
  if (!first || !end || !next || !colleague) throw new Error('Missing slots');
  const down = (element: HTMLElement, shiftKey: boolean) =>
    fireEvent(
      element,
      new MouseEvent('pointerdown', { button: 0, bubbles: true, shiftKey }),
    );
  down(first, true);
  fireEvent.pointerUp(window);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '1 demi-journée(s) · Camille',
  );
  down(end, true);
  fireEvent.pointerUp(window);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '4 demi-journée(s) · Camille',
  );
  down(end, false);
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.pointerEnter(colleague);
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
  fireEvent.pointerEnter(next);
  fireEvent.pointerUp(window);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '2 demi-journée(s) · Camille',
  );
  down(colleague, true);
  fireEvent.pointerUp(window);
  expect(screen.getByLabelText('Modifier la sélection')).toHaveTextContent(
    '1 demi-journée(s) · Alice',
  );
});
it('keeps enabled days editable and inserts newly displayed days in calendar order', async () => {
  week.work_days = [2, 4];
  mount('config');
  await screen.findByLabelText('Mercredi');
  expect(screen.getByLabelText('Mercredi')).toBeEnabled();
  expect(screen.getByLabelText('Vendredi')).toBeEnabled();
  fireEvent.click(screen.getByLabelText('Mardi'));
  await waitFor(() => {
    expect(submitted).toEqual({ work_days: [1, 2, 4] });
  });
});
it('keeps every other checkbox enabled when only one day remains', async () => {
  week.work_days = [2];
  mount('config');
  await screen.findByLabelText('Mercredi');
  expect(screen.getByLabelText('Mercredi')).toBeDisabled();
  for (const day of [
    'Lundi',
    'Mardi',
    'Jeudi',
    'Vendredi',
    'Samedi',
    'Dimanche',
  ])
    expect(screen.getByLabelText(day)).toBeEnabled();
});
it('matches accented colleague names with an unaccented search', async () => {
  const alice = week.users.find((user) => user.id === 'alice');
  if (!alice) throw new Error('Missing colleague');
  alice.first_name = 'Élise';
  mount();
  await screen.findByRole('heading', { name: 'Planning de l’équipe' });
  fireEvent.change(screen.getByLabelText('Rechercher un collaborateur'), {
    target: { value: 'elise' },
  });
  expect(screen.getByRole('rowheader', { name: 'Élise Martin' })).toBeVisible();
});
it('keeps responsive day navigation scoped to the selected view', async () => {
  const view = mount();
  await screen.findByLabelText('Jour affiché');
  expect(screen.getByLabelText('Jour affiché').parentElement).toHaveClass(
    'mobile-planning',
  );
  expect(
    screen.queryByRole('article', { name: 'Occupation Paris' }),
  ).not.toBeInTheDocument();
  const missing = screen.getByText(/10 demi-journée\(s\)/);
  expect(missing.textContent).toBe(
    '10 demi-journée(s) non renseignée(s) dans votre semaine. Renseigner ma semaine',
  );
  view.unmount();
  mount('locations');
  await screen.findByRole('article', { name: 'Occupation Paris' });
  expect(screen.getByLabelText('Jour affiché').parentElement).not.toHaveClass(
    'mobile-planning',
  );
});
it('preserves the afternoon value when opening a mixed day and clears stale selection errors', async () => {
  week.entries = [
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
    {
      user_id: 'me',
      date: currentWeek(),
      half: 'pm',
      status: 'remote',
      location_id: null,
      note: '',
    },
  ];
  server.use(
    http.put('/api/planning/entries', () =>
      HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
    ),
  );
  mount();
  const slots = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · Matin/,
  });
  const first = slots[0];
  if (!first) throw new Error('Missing slot');
  fireEvent.keyDown(first, { key: ' ', shiftKey: true });
  fireEvent.click(
    within(screen.getByLabelText('Modifier la sélection')).getByRole('button', {
      name: 'Absent',
    }),
  );
  await screen.findByRole('alert');
  fireEvent.click(first, { detail: 0 });
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText('Matin')).toHaveValue('office:paris');
  expect(within(dialog).getByLabelText('Après-midi')).toHaveValue('remote');
  expect(
    screen.queryByLabelText('Modifier la sélection'),
  ).not.toBeInTheDocument();
});
it('opens a touch-activated cell after a previous mouse drag', async () => {
  mount();
  const cells = await screen.findAllByRole('button', {
    name: /Camille Durand · .* · (Matin|Après-midi)/,
  });
  const first = cells[0];
  const last = cells[2];
  if (!first || !last) throw new Error('Missing slots');
  fireEvent(first, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  fireEvent.pointerEnter(last);
  fireEvent.pointerUp(window);
  const touch = new MouseEvent('pointerdown', { button: 0, bubbles: true });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  fireEvent(first, touch);
  fireEvent.click(first, { detail: 1 });
  expect(screen.getByRole('dialog')).toBeVisible();
});
