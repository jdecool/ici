import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PresenceEditor } from './PresenceEditor';
import type { Editing } from './PresenceEditor';
import type { Presence, Week } from './model';
const week: Week = {
  start: '2026-10-26',
  work_days: [0],
  teams: [],
  users: [],
  entries: [],
  locations: [
    { id: 'paris', name: 'Paris', city: 'Paris', code: 'PAR' },
    { id: 'lyon', name: 'Lyon', city: 'Lyon', code: 'LYO' },
  ],
};
const user = {
  id: 'alice',
  first_name: 'Alice',
  last_name: 'Martin',
  team_id: null,
  location_id: null,
};
const remote: Presence = { status: 'remote', location_id: null, note: '' };
it.each([
  ['Morning note', 'Afternoon note', 'Morning note'],
  ['', 'Afternoon note', 'Afternoon note'],
])(
  'preserves the initial note and submits a full-day edit (%s)',
  (amNote, pmNote, expectedNote) => {
    const editing: Editing = {
      user,
      date: '2026-10-26',
      am: { ...remote, note: amNote },
      pm: { ...remote, note: pmNote },
    };
    const submit = vi.fn();
    const close = vi.fn();
    render(
      <PresenceEditor
        editing={editing}
        week={week}
        canEdit
        busy={false}
        error=""
        close={close}
        submit={submit}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Alice Martin · 26 oct. 2026',
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Note')).toHaveValue(expectedNote);
    expect(screen.getByLabelText('Note')).toHaveAttribute('maxLength', '500');
    fireEvent.change(screen.getByLabelText('Journée entière'), {
      target: { value: 'travel' },
    });
    const form = screen
      .getByRole('button', { name: 'Enregistrer' })
      .closest('form');
    if (!form) throw new Error('Missing presence form');
    expect(fireEvent.submit(form)).toBe(false);
    expect(submit).toHaveBeenCalledWith({
      am: { status: 'travel', location_id: null, note: expectedNote },
      pm: { status: 'travel', location_id: null, note: expectedNote },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(close).toHaveBeenCalledOnce();
  },
);
it('opens split mode for different office locations and can merge back to the morning', () => {
  const editing: Editing = {
    user,
    date: '2026-10-26',
    am: { status: 'office', location_id: 'paris', note: '' },
    pm: { status: 'office', location_id: 'lyon', note: '' },
  };
  const submit = vi.fn();
  render(
    <PresenceEditor
      editing={editing}
      week={week}
      canEdit
      busy={false}
      error=""
      close={vi.fn()}
      submit={submit}
    />,
  );
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByLabelText('Matin')).toHaveValue('office:paris');
  expect(screen.getByLabelText('Après-midi')).toHaveValue('office:lyon');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByLabelText('Journée entière')).toHaveValue('office:paris');
  const form = screen
    .getByRole('button', { name: 'Enregistrer' })
    .closest('form');
  if (!form) throw new Error('Missing presence form');
  fireEvent.submit(form);
  expect(submit).toHaveBeenCalledWith({ am: editing.am, pm: editing.am });
});
it('shows both half-day values and their notes without edit controls', () => {
  const editing: Editing = {
    user,
    date: '2026-10-26',
    am: { status: 'office', location_id: 'paris', note: 'Morning visit' },
    pm: { status: 'off', location_id: null, note: 'Afternoon leave' },
  };
  render(
    <PresenceEditor
      editing={editing}
      week={week}
      canEdit={false}
      busy={false}
      error=""
      close={vi.fn()}
      submit={vi.fn()}
    />,
  );
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText('Matin : Présentiel · Paris Morning visit'),
  ).toBeVisible();
  expect(
    within(dialog).getByText('Après-midi : Absent Afternoon leave'),
  ).toBeVisible();
  expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: 'Enregistrer' }),
  ).not.toBeInTheDocument();
});
