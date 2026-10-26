import { StrictMode } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { MyWeek } from './MyWeek';
import { currentWeek } from './model';
import type { Week } from './model';
let week: Week;
const edit = vi.fn();
const write = vi.fn();
const action = vi.fn<(task: () => Promise<void>) => void>();
beforeEach(() => {
  vi.clearAllMocks();
  week = {
    start: currentWeek(),
    work_days: [0],
    users: [
      {
        id: 'me',
        first_name: 'Camille',
        last_name: 'Durand',
        team_id: null,
        location_id: 'paris',
      },
    ],
    locations: [{ id: 'paris', name: 'Paris', code: 'PAR', city: 'Paris' }],
    teams: [],
    entries: [],
  };
  server.use(
    http.get('/api/planning/template', () =>
      HttpResponse.json({ entries: [] }),
    ),
  );
});
function mount(busy = false) {
  const me = week.users[0];
  if (!me) throw new Error('Missing user');
  return render(
    <MyWeek
      week={week}
      me={me}
      csrf="csrf"
      busy={busy}
      edit={edit}
      write={write}
      action={action}
    />,
  );
}
it('offers whole-day shortcuts and opens detailed editing for individual halves', async () => {
  mount();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  for (const label of [
    'Matin : Non renseigné',
    'Après-midi : Non renseigné',
    'Modifier la journée',
  ]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(edit).toHaveBeenLastCalledWith(currentWeek());
  }
  fireEvent.click(screen.getByRole('button', { name: 'Bureau · Paris' }));
  expect(write).toHaveBeenLastCalledWith(currentWeek(), {
    status: 'office',
    location_id: 'paris',
    note: '',
  });
  for (const [label, status] of [
    ['Distanciel', 'remote'],
    ['Déplacement', 'travel'],
    ['Absent', 'off'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(write).toHaveBeenLastCalledWith(currentWeek(), {
      status,
      location_id: null,
      note: '',
    });
  }
  await screen.findAllByRole('combobox');
});
it('asks for a location when no usual location exists and disables office when none exist', async () => {
  const me = week.users[0];
  if (!me) throw new Error('Missing user');
  me.location_id = null;
  const view = mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Bureau : choisir un lieu' }),
  );
  expect(edit).toHaveBeenCalledWith(currentWeek());
  expect(write).not.toHaveBeenCalled();
  view.unmount();
  week.locations = [];
  mount();
  expect(
    screen.getByRole('button', { name: 'Bureau : choisir un lieu' }),
  ).toBeDisabled();
  await screen.findAllByRole('combobox');
});
it('retries template loading and reports save failures without committing the choice', async () => {
  server.use(http.get('/api/planning/template', () => HttpResponse.error()));
  mount();
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Le service est indisponible. Veuillez réessayer. Réessayer',
  );
  server.use(
    http.get('/api/planning/template', () =>
      HttpResponse.json({ entries: [] }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  const fields = await screen.findAllByRole('combobox');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  server.use(
    http.put('/api/planning/template', () =>
      HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
    ),
  );
  fireEvent.change(fields[0] ?? document.body, { target: { value: 'remote' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('droits');
  expect(fields[0]).toHaveValue('none');
});
it('preserves other template slots, clears a slot and applies one week', async () => {
  server.use(
    http.get('/api/planning/template', () =>
      HttpResponse.json({
        entries: [
          {
            weekday: 0,
            half: 'am',
            status: 'remote',
            location_id: null,
            note: '',
          },
          {
            weekday: 6,
            half: 'pm',
            status: 'off',
            location_id: null,
            note: '',
          },
        ],
      }),
    ),
  );
  let body: unknown;
  server.use(
    http.put('/api/planning/template', async ({ request }) => {
      body = await request.json();
      expect(request.headers.get('x-csrf-token')).toBe('csrf');
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  const fields = await screen.findAllByRole('combobox');
  fireEvent.change(fields[0] ?? document.body, { target: { value: 'none' } });
  await waitFor(() => {
    expect(body).toMatchObject({
      entries: [
        { weekday: 6, half: 'pm', status: 'off' },
        { weekday: 0, half: 'am', status: 'none' },
      ],
    });
  });
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Appliquer à cette semaine' }),
    ).toBeEnabled();
  });
  server.use(
    http.post('/api/planning/template/apply', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ updated: true });
    }),
  );
  action.mockImplementation((task) => {
    void task();
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Appliquer à cette semaine' }),
  );
  await waitFor(() => {
    expect(body).toEqual({ start: currentWeek(), weeks: 1 });
  });
});
it('disables all writes during a presence mutation', async () => {
  mount(true);
  await screen.findAllByRole('combobox');
  expect(screen.getByRole('button', { name: 'Bureau · Paris' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Appliquer à cette semaine' }),
  ).toBeDisabled();
});
it('ignores an obsolete StrictMode template response', async () => {
  let calls = 0;
  server.use(
    http.get('/api/planning/template', async () => {
      calls += 1;
      const status = calls === 1 ? 'remote' : 'off';
      if (calls === 1) await delay(70);
      return HttpResponse.json({
        entries: [
          { weekday: 0, half: 'am', status, location_id: null, note: '' },
        ],
      });
    }),
  );
  const me = week.users[0];
  if (!me) throw new Error('Missing user');
  render(
    <StrictMode>
      <MyWeek
        week={week}
        me={me}
        csrf="csrf"
        busy={false}
        edit={edit}
        write={write}
        action={action}
      />
    </StrictMode>,
  );
  const group = await screen.findByRole('group', { name: 'Lundi' });
  await waitFor(() => {
    expect(within(group).getByLabelText('Matin')).toHaveValue('off');
  });
  await delay(100);
  expect(within(group).getByLabelText('Matin')).toHaveValue('off');
});
it('preserves all other weekday and half slots while persisting a replacement', async () => {
  week.start = '2026-10-26';
  week.work_days = [0, 1];
  week.entries = [
    {
      user_id: 'me',
      date: week.start,
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
    {
      user_id: 'me',
      date: week.start,
      half: 'pm',
      status: 'remote',
      location_id: null,
      note: '',
    },
  ];
  const entries = [
    {
      weekday: 0,
      half: 'am',
      status: 'office',
      location_id: 'paris',
      note: '',
    },
    { weekday: 0, half: 'pm', status: 'remote', location_id: null, note: '' },
    { weekday: 1, half: 'am', status: 'travel', location_id: null, note: '' },
    { weekday: 1, half: 'pm', status: 'off', location_id: null, note: '' },
    { weekday: 6, half: 'pm', status: 'off', location_id: null, note: '' },
  ];
  server.use(
    http.get('/api/planning/template', () => HttpResponse.json({ entries })),
  );
  let submitted: unknown;
  server.use(
    http.put('/api/planning/template', async ({ request }) => {
      submitted = await request.json();
      await delay(60);
      return HttpResponse.json({ updated: true });
    }),
  );
  mount();
  const monday = await screen.findByRole('group', { name: 'Lundi' });
  const tuesday = screen.getByRole('group', { name: 'Mardi' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lundi 26' })).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Matin : Présentiel · Paris' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Après-midi : Distanciel' }),
  ).toBeVisible();
  expect(within(monday).getByLabelText('Matin')).toHaveValue('office:paris');
  expect(within(monday).getByLabelText('Après-midi')).toHaveValue('remote');
  expect(within(tuesday).getByLabelText('Matin')).toHaveValue('travel');
  expect(within(tuesday).getByLabelText('Après-midi')).toHaveValue('off');
  fireEvent.change(within(monday).getByLabelText('Matin'), {
    target: { value: 'none' },
  });
  expect(within(monday).getByLabelText('Après-midi')).toBeDisabled();
  await waitFor(() => {
    expect(submitted).toEqual({
      entries: [
        ...entries.slice(1),
        { weekday: 0, half: 'am', status: 'none', location_id: null, note: '' },
      ],
    });
  });
  await waitFor(() => {
    expect(within(monday).getByLabelText('Matin')).toBeEnabled();
  });
  expect(within(monday).getByLabelText('Matin')).toHaveValue('none');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Modifier la journée' })[0] ??
      document.body,
  );
  expect(edit).toHaveBeenCalledWith('2026-10-26');
});
it('clears the template load error after a retry and ignores obsolete errors', async () => {
  let calls = 0;
  server.use(
    http.get('/api/planning/template', async () => {
      calls += 1;
      if (calls === 1) {
        await delay(70);
        return HttpResponse.error();
      }
      return HttpResponse.json({ entries: [] });
    }),
  );
  const me = week.users[0];
  if (!me) throw new Error('Missing user');
  render(
    <StrictMode>
      <MyWeek
        week={week}
        me={me}
        csrf="csrf"
        busy={false}
        edit={edit}
        write={write}
        action={action}
      />
    </StrictMode>,
  );
  await screen.findAllByRole('combobox');
  await delay(100);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
