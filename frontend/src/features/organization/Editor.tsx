import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, errorMessage } from '../../shared/api';
import { Field, formText } from '../../shared/Field';
import { Dialog } from './Dialog';
import { mutate } from './api';
import type { Location, Member, Team } from './api';

export type Editing =
  | { kind: 'location'; value?: Location }
  | { kind: 'team'; value?: Team }
  | { kind: 'user'; value?: Member; team?: string };
export function Editor({
  editing,
  locations,
  teams,
  csrf,
  close,
  saved,
}: {
  editing: Editing;
  locations: Location[];
  teams: Team[];
  csrf: string;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const value = editing.value;
  const title =
    editing.kind === 'location'
      ? value
        ? 'Modifier le lieu'
        : 'Nouveau lieu'
      : editing.kind === 'team'
        ? value
          ? 'Modifier l’équipe'
          : 'Nouvelle équipe'
        : value
          ? 'Modifier l’utilisateur'
          : 'Inviter un utilisateur';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => formText(data, name);
    const body =
      editing.kind === 'location'
        ? {
            name: text('name'),
            code: text('code'),
            city: text('city'),
            address: text('address'),
          }
        : editing.kind === 'team'
          ? { name: text('name') }
          : {
              first_name: text('first_name'),
              last_name: text('last_name'),
              email: text('email'),
              role: text('role'),
              team_id: text('team_id') || null,
              location_id: text('location_id') || null,
            };
    const resource =
      editing.kind === 'location'
        ? 'locations'
        : editing.kind === 'team'
          ? 'teams'
          : 'users';
    setBusy(true);
    setError('');
    setFields({});
    try {
      await mutate(
        `/${resource}${value ? `/${value.id}` : ''}`,
        csrf,
        value ? 'PATCH' : 'POST',
        body,
      );
      saved();
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={title} busy={busy} close={close}>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset disabled={busy}>
          {editing.kind === 'location' ? (
            <>
              <Field
                label="Nom du lieu"
                name="name"
                defaultValue={editing.value?.name}
                required
                maxLength={100}
                error={fields['name']}
              />
              <Field
                label="Code"
                name="code"
                defaultValue={editing.value?.code}
                required
                minLength={2}
                maxLength={3}
                pattern="[A-Za-z]{2,3}"
                error={fields['code']}
              />
              <Field
                label="Ville"
                name="city"
                defaultValue={editing.value?.city}
                maxLength={500}
                error={fields['city']}
              />
              <Field
                label="Adresse"
                name="address"
                defaultValue={editing.value?.address}
                maxLength={500}
                error={fields['address']}
              />
            </>
          ) : editing.kind === 'team' ? (
            <Field
              label="Nom de l’équipe"
              name="name"
              defaultValue={editing.value?.name}
              required
              maxLength={100}
              error={fields['name']}
            />
          ) : (
            <>
              <Field
                label="Prénom"
                name="first_name"
                defaultValue={editing.value?.first_name}
                required
                maxLength={100}
                error={fields['first_name']}
              />
              <Field
                label="Nom"
                name="last_name"
                defaultValue={editing.value?.last_name}
                required
                maxLength={100}
                error={fields['last_name']}
              />
              <Field
                label="Email professionnel"
                name="email"
                type="email"
                defaultValue={
                  editing.value?.pending_email ?? editing.value?.email
                }
                required
                maxLength={254}
                error={fields['email']}
              />
              {editing.value?.pending_email && (
                <p>
                  Adresse actuelle : {editing.value.email}. La nouvelle adresse
                  attend une confirmation.
                </p>
              )}
              <label>
                Rôle
                <select name="role" defaultValue={editing.value?.role}>
                  <option value="collaborator">Collaborateur</option>
                  <option value="admin">Administrateur</option>
                </select>
              </label>
              <label>
                Équipe
                <select
                  name="team_id"
                  defaultValue={editing.value?.team_id ?? editing.team}
                >
                  <option value="">Sans équipe</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              {fields['team_id'] && (
                <p className="error">{fields['team_id']}</p>
              )}
              <label>
                Lieu habituel
                <select
                  name="location_id"
                  defaultValue={editing.value?.location_id ?? undefined}
                >
                  <option value="">Sans lieu habituel</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              {fields['location_id'] && (
                <p className="error">{fields['location_id']}</p>
              )}
              <p>
                {editing.value
                  ? 'Une nouvelle adresse email doit être confirmée avant de remplacer l’adresse actuelle.'
                  : 'Un email permettra à cette personne de choisir son mot de passe et d’accepter les conditions.'}
              </p>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="workspace-actions">
          <button type="button" disabled={busy} onClick={close}>
            Annuler
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? 'Enregistrement…'
              : value
                ? 'Enregistrer'
                : editing.kind === 'user'
                  ? 'Envoyer l’invitation'
                  : 'Créer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
