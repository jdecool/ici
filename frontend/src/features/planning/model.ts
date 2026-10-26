export const days = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];
export const halves = ['am', 'pm'] as const;
export type Half = (typeof halves)[number];
export const labels = {
  office: 'Présentiel',
  remote: 'Distanciel',
  travel: 'Déplacement',
  off: 'Absent',
  none: 'Non renseigné',
};
export type Status = keyof typeof labels;
export interface Presence {
  status: Status;
  location_id: string | null;
  note: string;
}
export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  team_id: string | null;
  location_id: string | null;
}
export interface Location {
  id: string;
  name: string;
  code: string;
  city: string;
}
export interface Entry extends Presence {
  user_id: string;
  date: string;
  half: Half;
}
export interface TemplateEntry extends Presence {
  weekday: number;
  half: Half;
}
export interface Week {
  start: string;
  work_days: number[];
  users: Person[];
  teams: { id: string; name: string }[];
  locations: Location[];
  entries: Entry[];
}
export const empty: Presence = { status: 'none', location_id: null, note: '' };
export function iso(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function add(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return iso(date);
}
export function currentWeek(): string {
  const today = new Date();
  return add(iso(today), -((today.getDay() + 6) % 7));
}
export function formatted(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function fullName(user: Person): string {
  return `${user.first_name} ${user.last_name}`;
}
export function entry(
  week: Week,
  user: string,
  date: string,
  half: Half,
): Presence {
  return (
    week.entries.find(
      (e) => e.user_id === user && e.date === date && e.half === half,
    ) ?? empty
  );
}
export function description(value: Presence, locations: Location[]): string {
  return value.status === 'office'
    ? `Présentiel · ${locations.find((l) => l.id === value.location_id)?.name ?? 'Lieu indisponible'}`
    : labels[value.status];
}
export function occupancy(
  week: Week,
  location: string,
  date: string,
  half: Half,
): Person[] {
  return week.users.filter((user) => {
    const value = entry(week, user.id, date, half);
    return value.location_id === location;
  });
}
