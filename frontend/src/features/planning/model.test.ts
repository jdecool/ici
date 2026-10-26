import { expect, it, vi } from 'vitest';
import {
  add,
  currentWeek,
  description,
  empty,
  entry,
  formatted,
  iso,
  occupancy,
} from './model';
import type { Week } from './model';
it.each([
  ['2026-10-26', '2026-10-26'],
  ['2026-10-28', '2026-10-26'],
  ['2026-11-01', '2026-10-26'],
  ['2026-01-01', '2025-12-29'],
])('starts the current week on %s at Monday %s', (today, monday) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(`${today}T12:00:00`));
    expect(currentWeek()).toBe(monday);
  } finally {
    vi.useRealTimers();
  }
});
it('uses civil dates over leap years and year boundaries', () => {
  expect(add('2024-02-28', 2)).toBe('2024-03-01');
  expect(add('2025-12-29', 7)).toBe('2026-01-05');
  expect(add('2026-01-01', -1)).toBe('2025-12-31');
  expect(iso(new Date(2026, 0, 2))).toBe('2026-01-02');
  expect(new Date(`${currentWeek()}T12:00:00`).getDay()).toBe(1);
  expect(formatted('2026-10-26')).toContain('2026');
});
it('counts only the selected location and half, and describes missing entries', () => {
  const week: Week = {
    start: '2026-10-26',
    work_days: [0],
    users: [
      {
        id: 'a',
        first_name: 'A',
        last_name: 'B',
        team_id: null,
        location_id: null,
      },
    ],
    locations: [],
    teams: [],
    entries: [
      {
        user_id: 'a',
        date: '2026-10-26',
        half: 'pm',
        status: 'office',
        location_id: 'paris',
        note: 'Visit',
      },
    ],
  };
  expect(entry(week, 'a', '2026-10-26', 'am')).toEqual(empty);
  expect(occupancy(week, 'paris', '2026-10-26', 'am')).toEqual([]);
  expect(occupancy(week, 'lyon', '2026-10-26', 'pm')).toEqual([]);
  expect(occupancy(week, 'paris', '2026-10-26', 'pm')).toEqual(week.users);
  expect(description(empty, [])).toBe('Non renseigné');
  expect(
    description({ status: 'office', location_id: 'paris', note: '' }, []),
  ).toBe('Présentiel · Lieu indisponible');
  expect(
    description({ status: 'office', location_id: 'paris', note: '' }, [
      { id: 'paris', name: 'Paris', city: 'Paris', code: 'PAR' },
    ]),
  ).toBe('Présentiel · Paris');
});
it('formats French dates and preserves four-digit years', () => {
  expect(formatted('2026-10-26')).toBe('26 oct. 2026');
  expect(iso(new Date('0001-01-02T12:00:00'))).toBe('0001-01-02');
  expect(empty.note).toBe('');
});
it('resolves the requested office among multiple locations', () => {
  const locations = [
    { id: 'lyon', name: 'Lyon', city: 'Lyon', code: 'LYO' },
    { id: 'paris', name: 'Paris', city: 'Paris', code: 'PAR' },
  ];
  expect(
    description(
      { status: 'office', location_id: 'paris', note: '' },
      locations,
    ),
  ).toBe('Présentiel · Paris');
});
