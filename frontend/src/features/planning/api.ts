import { ApiError, object, request, string } from '../../shared/api';
import type { Entry, Half, Presence, TemplateEntry, Week } from './model';
function list<T>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw new ApiError('invalid_response');
  return value.map((item: unknown) => parse(object(item)));
}
function nullable(value: unknown): string | null {
  return value === null ? null : string(value);
}
function integer(value: unknown): number {
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return value;
    default:
      throw new ApiError('invalid_response');
  }
}
function half(value: unknown): Half {
  if (value !== 'am' && value !== 'pm') throw new ApiError('invalid_response');
  return value;
}
function presence(row: Record<string, unknown>): Presence {
  const status = row['status'];
  if (
    status !== 'office' &&
    status !== 'remote' &&
    status !== 'travel' &&
    status !== 'off' &&
    status !== 'none'
  )
    throw new ApiError('invalid_response');
  const location = nullable(row['location_id']);
  const note = string(row['note']);
  if (
    (status === 'office') !== (location !== null) ||
    Array.from(note).length > 500
  )
    throw new ApiError('invalid_response');
  return { status, location_id: location, note };
}
export async function loadWeek(start: string): Promise<Week> {
  const data = await request(
    `/planning/week?start=${encodeURIComponent(start)}`,
  );
  const workDays = data['work_days'];
  if (!Array.isArray(workDays) || !workDays.length)
    throw new ApiError('invalid_response');
  const work_days = workDays.map(integer);
  if (work_days.some((day, i) => day <= (work_days[i - 1] ?? -1)))
    throw new ApiError('invalid_response');
  if (data['start'] !== start) throw new ApiError('invalid_response');
  return {
    start,
    work_days,
    users: list(data['users'], (r) => ({
      id: string(r['id']),
      first_name: string(r['first_name']),
      last_name: string(r['last_name']),
      team_id: nullable(r['team_id']),
      location_id: nullable(r['location_id']),
    })),
    teams: list(data['teams'], (r) => ({
      id: string(r['id']),
      name: string(r['name']),
    })),
    locations: list(data['locations'], (r) => ({
      id: string(r['id']),
      name: string(r['name']),
      code: string(r['code']),
      city: string(r['city']),
    })),
    entries: list(data['entries'], (r) => ({
      ...presence(r),
      user_id: string(r['user_id']),
      date: string(r['date']),
      half: half(r['half']),
    })),
  };
}
export async function loadTemplate(): Promise<TemplateEntry[]> {
  const data = await request('/planning/template');
  return list(data['entries'], (r) => ({
    ...presence(r),
    weekday: integer(r['weekday']),
    half: half(r['half']),
  }));
}
export async function save(
  path: string,
  csrf: string,
  body: unknown,
  method = 'PUT',
): Promise<void> {
  const data = await request(
    `/planning/${path}`,
    body,
    { 'X-CSRF-Token': csrf },
    method,
  );
  if (data['updated'] !== true) throw new ApiError('invalid_response');
}
export function saveEntries(
  csrf: string,
  user: string,
  entries: Omit<Entry, 'user_id'>[],
): Promise<void> {
  return save('entries', csrf, { user_id: user, entries });
}
export function optionValue(presence: Presence): string {
  return presence.status === 'office'
    ? `office:${presence.location_id ?? ''}`
    : presence.status;
}
export function optionPresence(value: string): Presence {
  if (value.startsWith('office:'))
    return { status: 'office', location_id: value.slice(7), note: '' };
  if (
    value === 'remote' ||
    value === 'travel' ||
    value === 'off' ||
    value === 'none'
  )
    return { status: value, location_id: null, note: '' };
  throw new ApiError('invalid_response');
}
