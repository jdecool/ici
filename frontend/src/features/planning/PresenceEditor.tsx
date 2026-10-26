import { useState } from 'react';
import { Dialog } from '../organization';
import { description, empty, formatted, fullName, halves } from './model';
import type { Half, Person, Presence, Week } from './model';
import { optionPresence, optionValue } from './api';

export function Options({ week }: { week: Week }) {
  return (
    <>
      <option value="none">Non renseigné</option>
      {week.locations.map((l) => (
        <option key={l.id} value={`office:${l.id}`}>
          Présentiel · {l.name}
        </option>
      ))}
      <option value="remote">Distanciel</option>
      <option value="travel">Déplacement</option>
      <option value="off">Absent</option>
    </>
  );
}
export interface Editing {
  user: Person;
  date: string;
  am: Presence;
  pm: Presence;
}
export function PresenceEditor({
  editing,
  week,
  canEdit,
  busy,
  error,
  close,
  submit,
}: {
  editing: Editing;
  week: Week;
  canEdit: boolean;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (values: Record<Half, Presence>) => void;
}) {
  const [am, setAm] = useState(editing.am);
  const [pm, setPm] = useState(editing.pm);
  const [split, setSplit] = useState(optionValue(am) !== optionValue(pm));
  const [note, setNote] = useState(am.note || pm.note);
  function values() {
    return { am: { ...am, note }, pm: { ...(split ? pm : am), note } };
  }
  return (
    <Dialog
      title={`${fullName(editing.user)} · ${formatted(editing.date)}`}
      busy={busy}
      close={close}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!canEdit ? (
        <>
          <p>Consultation uniquement</p>
          {halves.map((h) => (
            <p key={h}>
              {h === 'am' ? 'Matin' : 'Après-midi'} :{' '}
              {description(editing[h], week.locations)} {editing[h].note}
            </p>
          ))}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(values());
          }}
        >
          <fieldset disabled={busy}>
            <label>
              <input
                type="checkbox"
                checked={split}
                onChange={(e) => {
                  setSplit(e.target.checked);
                }}
              />
              Matin ≠ après-midi
            </label>
            <label>
              {split ? 'Matin' : 'Journée entière'}
              <select
                value={optionValue(am)}
                onChange={(e) => {
                  setAm(optionPresence(e.target.value));
                }}
              >
                <Options week={week} />
              </select>
            </label>
            {split && (
              <>
                <label>
                  Après-midi
                  <select
                    value={optionValue(pm)}
                    onChange={(e) => {
                      setPm(optionPresence(e.target.value));
                    }}
                  >
                    <Options week={week} />
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPm(am);
                  }}
                >
                  Copier le matin
                </button>
              </>
            )}
            <label>
              Note
              <textarea
                maxLength={500}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </label>
            <div className="workspace-actions">
              <button type="submit" className="primary">
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => {
                  submit({ am: empty, pm: empty });
                }}
              >
                Effacer la journée
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <button disabled={busy} onClick={close}>
        Fermer
      </button>
    </Dialog>
  );
}
