import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { server } from '../../test/server';
import { load, mutate } from './api';
const location = {
  id: 'paris',
  name: 'Paris',
  members: 0,
  code: 'PAR',
  city: '',
  address: '',
};
const member = {
  id: 'alice',
  first_name: 'Alice',
  last_name: 'Martin',
  email: 'alice@example.com',
  pending_email: null,
  role: 'collaborator',
  status: 'active',
  team_id: null,
  location_id: null,
};
function handlers(
  locationPayload: unknown,
  teamPayload: unknown,
  userPayload: unknown,
) {
  server.use(
    http.get('/api/locations', () =>
      HttpResponse.json({ locations: locationPayload }),
    ),
    http.get('/api/teams', () => HttpResponse.json({ teams: teamPayload })),
    http.get('/api/users', () => HttpResponse.json({ users: userPayload })),
  );
}
it('parses complete organization responses and skips admin endpoints for collaborators', async () => {
  handlers(
    [location],
    [{ id: 'engineering', name: 'Engineering', members: 1 }],
    [
      member,
      {
        ...member,
        id: 'bob',
        role: 'admin',
        status: 'inactive',
        team_id: 'engineering',
        location_id: 'paris',
        pending_email: 'pending@example.com',
      },
    ],
  );
  expect(await load(true)).toEqual({
    locations: [location],
    teams: [{ id: 'engineering', name: 'Engineering', members: 1 }],
    users: [
      member,
      {
        ...member,
        id: 'bob',
        role: 'admin',
        status: 'inactive',
        team_id: 'engineering',
        location_id: 'paris',
        pending_email: 'pending@example.com',
      },
    ],
  });
  expect(await load(false)).toEqual({
    locations: [location],
    teams: [],
    users: [],
  });
});
it.each([
  null,
  {},
  'invalid',
  [null],
  [{ ...location, members: -1 }],
  [{ ...location, members: 1.5 }],
  [{ ...location, members: '1' }],
  [{ ...location, code: null }],
])('rejects invalid location collections %j', async (payload) => {
  handlers(payload, [], []);
  await expect(load(false)).rejects.toMatchObject({ code: 'invalid_response' });
});
it.each([
  { role: 'owner' },
  { status: 'unknown' },
  { team_id: 1 },
  { location_id: false },
  { pending_email: {} },
  { email: null },
])('rejects malformed account data %j', async (overrides) => {
  handlers([], [], [{ ...member, ...overrides }]);
  await expect(load(true)).rejects.toMatchObject({ code: 'invalid_response' });
});
it.each(['POST', 'PATCH', 'DELETE'] as const)(
  'sends authenticated %s mutations',
  async (method) => {
    server.use(
      http.all('/api/teams/team', async ({ request }) => {
        expect(request.method).toBe(method);
        expect(request.headers.get('x-csrf-token')).toBe('csrf');
        expect(await request.json()).toEqual({ name: 'Engineering' });
        return HttpResponse.json({ updated: true });
      }),
    );
    expect(
      await mutate('/teams/team', 'csrf', method, { name: 'Engineering' }),
    ).toEqual({ updated: true });
  },
);
it('sends an empty object for invitation resend', async () => {
  server.use(
    http.post('/api/users/alice/invitation', async ({ request }) => {
      expect(await request.json()).toEqual({});
      return HttpResponse.json({ sent: true });
    }),
  );
  expect(await mutate('/users/alice/invitation', 'csrf', 'POST')).toEqual({
    sent: true,
  });
});
