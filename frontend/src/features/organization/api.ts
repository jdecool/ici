import { ApiError, object, request, string } from '../../shared/api';

export interface Team {
  id: string;
  name: string;
  members: number;
}
export interface Location extends Team {
  code: string;
  city: string;
  address: string;
}
export type Role = 'admin' | 'collaborator';
export type Status = 'pending' | 'active' | 'inactive';
export interface Member {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  pending_email: string | null;
  role: Role;
  status: Status;
  team_id: string | null;
  location_id: string | null;
}
function nullable(value: unknown): string | null {
  return value === null ? null : string(value);
}
export function role(value: unknown): Role {
  if (value !== 'admin' && value !== 'collaborator')
    throw new ApiError('invalid_response');
  return value;
}
function status(value: unknown): Status {
  if (value !== 'pending' && value !== 'active' && value !== 'inactive')
    throw new ApiError('invalid_response');
  return value;
}
function count(value: unknown): number {
  switch (typeof value) {
    case 'number':
      if (!Number.isSafeInteger(value) || value < 0)
        throw new ApiError('invalid_response');
      return value;
    default:
      throw new ApiError('invalid_response');
  }
}
function list<T>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw new ApiError('invalid_response');
  return value.map((row: unknown) => parse(object(row)));
}
function team(row: Record<string, unknown>): Team {
  return {
    id: string(row['id']),
    name: string(row['name']),
    members: count(row['members']),
  };
}
export async function load(
  admin: boolean,
): Promise<{ locations: Location[]; teams: Team[]; users: Member[] }> {
  const locations = await request('/locations');
  const teams = admin ? await request('/teams') : {};
  const users = admin ? await request('/users') : {};
  return {
    locations: list(locations['locations'], (row) => ({
      ...team(row),
      code: string(row['code']),
      city: string(row['city']),
      address: string(row['address']),
    })),
    teams: admin ? list(teams['teams'], team) : [],
    users: admin
      ? list(users['users'], (row) => ({
          id: string(row['id']),
          first_name: string(row['first_name']),
          last_name: string(row['last_name']),
          email: string(row['email']),
          pending_email: nullable(row['pending_email']),
          role: role(row['role']),
          status: status(row['status']),
          team_id: nullable(row['team_id']),
          location_id: nullable(row['location_id']),
        }))
      : [],
  };
}
export async function mutate(
  path: string,
  csrf: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown = {},
) {
  return request(path, body, { 'X-CSRF-Token': csrf }, method);
}
