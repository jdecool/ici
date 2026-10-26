import { beforeEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import {
  loadTemplate,
  loadWeek,
  optionPresence,
  optionValue,
  save,
} from './api';
let payload: Record<string, unknown>;
beforeEach(() => {
  payload = {
    start: '2026-10-26',
    work_days: [0],
    users: [],
    teams: [],
    locations: [],
    entries: [],
  };
  server.use(http.get('/api/planning/week', () => HttpResponse.json(payload)));
});
it('validates the weekly response and every nested record', async () => {
  expect(await loadWeek('2026-10-26')).toEqual(payload);
  for (const [key, value] of Object.entries({
    start: '2026-10-27',
    work_days: [],
    users: [null],
    teams: [{ id: 3 }],
    locations: [{ id: 'a', name: 'A', code: 'A', city: 3 }],
    entries: [{ status: 'unknown' }],
  })) {
    const old = payload[key];
    payload[key] = value;
    await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
    payload[key] = old;
  }
  for (const days of [null, '0', [7], [-1], [1.5], [1, 0], [0, 0]]) {
    payload['work_days'] = days;
    await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
  }
});
it('validates slots and presence values', async () => {
  const row = {
    user_id: 'a',
    date: '2026-10-26',
    half: 'am',
    status: 'office',
    location_id: 'paris',
    note: '',
  };
  payload['entries'] = [row];
  expect((await loadWeek('2026-10-26')).entries).toEqual([row]);
  for (const patch of [
    { half: 'night' },
    { status: 'remote' },
    { location_id: null },
    { note: 3 },
    { note: 'x'.repeat(1001) },
  ]) {
    payload['entries'] = [{ ...row, ...patch }];
    await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
  }
  payload['entries'] = [
    { ...row, half: 'pm', status: 'remote', location_id: null },
  ];
  expect((await loadWeek('2026-10-26')).entries[0]?.half).toBe('pm');
});
it('loads templates and checks mutation acknowledgements', async () => {
  server.use(
    http.get('/api/planning/template', () =>
      HttpResponse.json({
        entries: [
          {
            weekday: 0,
            half: 'pm',
            status: 'remote',
            location_id: null,
            note: '',
          },
        ],
      }),
    ),
  );
  expect((await loadTemplate())[0]?.weekday).toBe(0);
  server.use(
    http.put('/api/planning/settings', () =>
      HttpResponse.json({ updated: false }),
    ),
  );
  await expect(save('settings', 'csrf', { work_days: [0] })).rejects.toThrow(
    'invalid_response',
  );
});
it('round trips all editor choices', () => {
  for (const value of ['office:paris', 'remote', 'travel', 'off', 'none'])
    expect(optionValue(optionPresence(value))).toBe(value);
  expect(optionValue({ status: 'office', location_id: null, note: '' })).toBe(
    'office:',
  );
  expect(() => optionPresence('invalid')).toThrow('invalid_response');
});
it('accepts each status and validates full Unicode note lengths', async () => {
  for (const status of ['office', 'remote', 'travel', 'off', 'none']) {
    const row = {
      user_id: 'a',
      date: '2026-10-26',
      half: 'am',
      status,
      location_id: status === 'office' ? 'paris' : null,
      note: 'é'.repeat(500),
    };
    payload['entries'] = [row];
    expect((await loadWeek('2026-10-26')).entries).toEqual([row]);
  }
  payload['entries'] = [
    {
      user_id: 'a',
      date: '2026-10-26',
      half: 'pm',
      status: 'remote',
      location_id: null,
      note: '😀'.repeat(500),
    },
  ];
  expect((await loadWeek('2026-10-26')).entries[0]?.note).toBe(
    '😀'.repeat(500),
  );
  payload['entries'] = [
    {
      user_id: 'a',
      date: '2026-10-26',
      half: 'pm',
      status: 'remote',
      location_id: null,
      note: 'é'.repeat(501),
    },
  ];
  await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
  payload['entries'] = [];
  for (const workDays of [[1], [6], [0, 1, 2, 3, 4, 5, 6]]) {
    payload['work_days'] = workDays;
    expect((await loadWeek('2026-10-26')).work_days).toEqual(workDays);
  }
  payload['work_days'] = ['0'];
  await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
  payload['work_days'] = [0];
  payload['teams'] = 'invalid';
  await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
});
it('creates editor choices with empty notes and exact location identifiers', () => {
  expect(optionPresence('office:paris')).toEqual({
    status: 'office',
    location_id: 'paris',
    note: '',
  });
  for (const status of ['remote', 'travel', 'off', 'none'])
    expect(optionPresence(status)).toEqual({
      status,
      location_id: null,
      note: '',
    });
});

it('rejects an otherwise valid slot with an unknown status', async () => {
  payload['entries'] = [
    {
      user_id: 'a',
      date: '2026-10-26',
      half: 'am',
      status: 'unknown',
      location_id: null,
      note: '',
    },
  ];
  await expect(loadWeek('2026-10-26')).rejects.toThrow('invalid_response');
});
