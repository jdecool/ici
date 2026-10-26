import { useEffect, useState } from 'react';
import { errorMessage } from '../../shared/api';
import { add, days, description, empty, entry, halves } from './model';
import type { Person, Presence, TemplateEntry, Week } from './model';
import { loadTemplate, optionPresence, optionValue, save } from './api';
import { Options } from './PresenceEditor';

export function MyWeek({
  week,
  me,
  csrf,
  busy,
  edit,
  write,
  action,
}: {
  week: Week;
  me: Person;
  csrf: string;
  busy: boolean;
  edit: (date: string) => void;
  write: (date: string, value: Presence) => void;
  action: (task: () => Promise<void>) => void;
}) {
  const [template, setTemplate] = useState<TemplateEntry[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    void loadTemplate()
      .then((result) => {
        if (current) {
          setTemplate(result);
          setError('');
        }
      })
      .catch((error: unknown) => {
        if (current) setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [revision]);
  async function update(next: TemplateEntry[]) {
    setSaving(true);
    setError('');
    try {
      await save('template', csrf, { entries: next });
      setTemplate(next);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  const home = week.locations.find((l) => l.id === me.location_id);
  const disabled = busy || saving;
  return (
    <div className="my-week-layout">
      <section aria-label="Mes présences">
        {week.work_days.map((day) => {
          const date = add(week.start, day);
          return (
            <article className="workspace-card" key={day}>
              <h3>
                {days[day]} {new Date(`${date}T12:00:00`).getDate()}
              </h3>
              {halves.map((h) => (
                <button
                  key={h}
                  disabled={disabled}
                  onClick={() => {
                    edit(date);
                  }}
                >
                  {h === 'am' ? 'Matin' : 'Après-midi'} :{' '}
                  {description(entry(week, me.id, date, h), week.locations)}
                </button>
              ))}
              <div className="workspace-actions">
                <button
                  disabled={disabled || !week.locations.length}
                  onClick={() => {
                    if (home)
                      write(date, {
                        status: 'office',
                        location_id: home.id,
                        note: '',
                      });
                    else edit(date);
                  }}
                >
                  {home ? `Bureau · ${home.name}` : 'Bureau : choisir un lieu'}
                </button>
                {(['remote', 'travel', 'off'] as const).map((status) => (
                  <button
                    key={status}
                    disabled={disabled}
                    onClick={() => {
                      write(date, optionPresence(status));
                    }}
                  >
                    {status === 'remote'
                      ? 'Distanciel'
                      : status === 'travel'
                        ? 'Déplacement'
                        : 'Absent'}
                  </button>
                ))}
                <button
                  disabled={disabled}
                  onClick={() => {
                    edit(date);
                  }}
                >
                  Modifier la journée
                </button>
              </div>
            </article>
          );
        })}
      </section>
      <section className="workspace-card" aria-label="Semaine type">
        <h3>Ma semaine type</h3>
        <p>
          Appliquée aux jours affichés, elle remplace les présences et les notes
          existantes.
        </p>
        {error && (
          <p role="alert">
            {error}{' '}
            <button
              onClick={() => {
                setRevision({});
              }}
            >
              Réessayer
            </button>
          </p>
        )}
        {!template ? (
          <p role="status">Chargement de la semaine type…</p>
        ) : (
          <>
            {week.work_days.map((day) => (
              <fieldset disabled={disabled} key={day}>
                <legend>{days[day]}</legend>
                {halves.map((h) => (
                  <label key={h}>
                    {h === 'am' ? 'Matin' : 'Après-midi'}
                    <select
                      value={optionValue(
                        template.find(
                          (e) => e.weekday === day && e.half === h,
                        ) ?? empty,
                      )}
                      onChange={(e) => {
                        const next = template.filter(
                          (v) => v.weekday !== day || v.half !== h,
                        );
                        next.push({
                          weekday: day,
                          half: h,
                          ...optionPresence(e.target.value),
                        });
                        void update(next);
                      }}
                    >
                      <Options week={week} />
                    </select>
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="workspace-actions">
              {[1, 4].map((weeks) => (
                <button
                  key={weeks}
                  disabled={disabled}
                  onClick={() => {
                    action(() =>
                      save(
                        'template/apply',
                        csrf,
                        { start: week.start, weeks },
                        'POST',
                      ),
                    );
                  }}
                >
                  {weeks === 1
                    ? 'Appliquer à cette semaine'
                    : 'Appliquer sur 4 semaines'}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
