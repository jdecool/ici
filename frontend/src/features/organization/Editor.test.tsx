import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { Editor } from './Editor';
import type { Editing } from './Editor';
const location = {
  id: 'paris',
  name: 'Paris',
  code: 'PAR',
  city: 'Paris',
  address: '12 rue',
  members: 0,
};
const team = { id: 'team', name: 'Engineering', members: 0 };
const user = {
  id: 'owner',
  first_name: 'Camille',
  last_name: 'Durand',
  email: 'owner@example.com',
  pending_email: 'new@example.com',
  role: 'admin' as const,
  status: 'active' as const,
  team_id: 'team',
  location_id: 'paris',
};
function mount(editing: Editing) {
  const saved = vi.fn();
  const close = vi.fn();
  render(
    <Editor
      editing={editing}
      locations={[location]}
      teams={[team]}
      csrf="csrf"
      close={close}
      saved={saved}
    />,
  );
  return { saved, close };
}
function submit() {
  const form = screen.getByRole('dialog').querySelector('form');
  if (!form) throw new Error('form');
  expect(fireEvent.submit(form)).toBe(false);
}
function noBlankParagraphs() {
  for (const paragraph of screen.getByRole('dialog').querySelectorAll('p'))
    expect(paragraph.textContent?.trim()).not.toBe('');
}
it.each<[Editing, string]>([
  [{ kind: 'location' }, 'Nouveau lieu'],
  [{ kind: 'location', value: location }, 'Modifier le lieu'],
  [{ kind: 'team' }, 'Nouvelle équipe'],
  [{ kind: 'team', value: team }, 'Modifier l’équipe'],
  [{ kind: 'user' }, 'Inviter un utilisateur'],
  [{ kind: 'user', value: user }, 'Modifier l’utilisateur'],
])(
  'labels each editor and preserves its initial fields: %j',
  (editing, title) => {
    mount(editing);
    expect(screen.getByRole('dialog', { name: title })).toBeVisible();
    noBlankParagraphs();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (editing.kind === 'user') {
      expect(screen.getByLabelText('Rôle')).toHaveValue(
        editing.value ? 'admin' : 'collaborator',
      );
      expect(screen.getByLabelText('Équipe')).toHaveValue(
        editing.value ? 'team' : '',
      );
      expect(screen.getByLabelText('Lieu habituel')).toHaveValue(
        editing.value ? 'paris' : '',
      );
      if (editing.value) {
        expect(
          screen.getByText(
            'Adresse actuelle : owner@example.com. La nouvelle adresse attend une confirmation.',
          ),
        ).toBeVisible();
        expect(
          screen.getByText(
            'Une nouvelle adresse email doit être confirmée avant de remplacer l’adresse actuelle.',
          ),
        ).toBeVisible();
      } else {
        expect(
          screen.getByText(
            'Un email permettra à cette personne de choisir son mot de passe et d’accepter les conditions.',
          ),
        ).toBeVisible();
        expect(screen.queryByText(/Adresse actuelle/)).not.toBeInTheDocument();
      }
    }
  },
);
it.each<[Editing, string, string[]]>([
  [
    { kind: 'location', value: location },
    '/api/locations/paris',
    ['name', 'code', 'city', 'address'],
  ],
  [{ kind: 'team', value: team }, '/api/teams/team', ['name']],
  [
    { kind: 'user', value: user },
    '/api/users/owner',
    ['first_name', 'last_name', 'email', 'team_id', 'location_id'],
  ],
])(
  'shows every field error, clears it during retry and prevents double submits: %j',
  async (editing, path, fields) => {
    let failure = true;
    server.use(
      http.patch(path, async () => {
        await delay(50);
        return failure
          ? HttpResponse.json(
              {
                code: 'invalid_input',
                fields: Object.fromEntries(
                  fields.map((field) => [field, 'invalid']),
                ),
              },
              { status: 422 },
            )
          : HttpResponse.json({ updated: true });
      }),
    );
    const { saved } = mount(editing);
    submit();
    expect(
      await screen.findByRole('button', { name: 'Enregistrement…' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.getAllByText('Vérifiez ce champ.')).toHaveLength(
      fields.length,
    );
    noBlankParagraphs();
    failure = false;
    submit();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Vérifiez ce champ.')).not.toBeInTheDocument();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  },
);
it('handles network failures without treating them as field errors', async () => {
  server.use(http.post('/api/teams', () => HttpResponse.error()));
  mount({ kind: 'team' });
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible. Veuillez réessayer.',
  );
  expect(
    within(screen.getByRole('dialog')).queryByText('Vérifiez ce champ.'),
  ).not.toBeInTheDocument();
});
