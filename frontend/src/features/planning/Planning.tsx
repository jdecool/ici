import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../shared/api';
import { loadWeek, save, saveEntries } from './api';
import {
  add,
  currentWeek,
  days,
  description,
  empty,
  entry,
  formatted,
  fullName,
  halves,
  labels,
} from './model';
import type { Half, Person, Presence, Week } from './model';
import { PresenceEditor } from './PresenceEditor';
import type { Editing } from './PresenceEditor';
import { MyWeek } from './MyWeek';
import { Occupancy } from './Occupancy';
import './style.css';

export type PlanningView = 'planning' | 'me' | 'config' | 'locations';
interface Selection {
  user: string;
  anchor: number;
  end: number;
}
export function Planning({
  view,
  session,
  goMe,
  // Stryker disable next-line ArrowFunction: React renders both null and undefined as no content when no location renderer is supplied.
  renderLocation = () => null,
}: {
  view: PlanningView;
  session: { id: string; role: string; csrf: string };
  goMe: () => void;
  renderLocation?: (id: string) => ReactNode;
}) {
  const [start, setStart] = useState(currentWeek);
  const [week, setWeek] = useState<Week | null>(null);
  const [revision, setRevision] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Stryker disable next-line BooleanLiteral: With no initial week, both boolean values render the same loading branch until the response sets loading to false.
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const drag = useRef<Selection | null>(null);
  // Stryker disable next-line BooleanLiteral: Every pointer press resets this flag before any guard; keyboard activation ignores it.
  const moved = useRef(false);
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('');
  const [location, setLocation] = useState('');
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedHalf, setSelectedHalf] = useState<Half>('am');
  const admin = session.role === 'admin';
  useEffect(() => {
    let current = true;
    void loadWeek(start)
      .then((result) => {
        if (current) {
          setWeek(result);
          setError('');
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setError(errorMessage(error));
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [start, revision]);
  useEffect(
    () => {
      const up = () => {
        drag.current = null;
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setSelection(null);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', key);
      return () => {
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', key);
      };
    },
    // Stryker disable next-line ArrayDeclaration: An empty list and a constant sentinel have the same mount-only subscription lifetime.
    [],
  );
  const [previousView, setPreviousView] = useState(view);
  if (previousView !== view) {
    setPreviousView(view);
    setSelection(null);
    setEditing(null);
  }
  function reload() {
    setLoading(true);
    setSelection(null);
    setEditing(null);
    setRevision({});
  }
  function navigate(value: string) {
    setStart(value);
    setNotice('');
    reload();
  }
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      setNotice('Modification enregistrée.');
      reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function open(user: Person, date: string) {
    if (!week || busy) return;
    setError('');
    setSelection(null);
    setEditing({
      user,
      date,
      am: entry(week, user.id, date, 'am'),
      pm: entry(week, user.id, date, 'pm'),
    });
  }
  function write(user: string, date: string, values: Record<Half, Presence>) {
    void action(() =>
      saveEntries(
        session.csrf,
        user,
        halves.map((half) => ({ date, half, ...values[half] })),
      ),
    );
  }
  if (!week || loading || week.start !== start)
    return (
      <>
        <p role="status">Chargement du planning…</p>
        {error && (
          <p role="alert">
            {error} <button onClick={reload}>Réessayer</button>
          </p>
        )}
      </>
    );
  const data = week;
  const day = data.work_days.includes(selectedDay)
    ? selectedDay
    : (data.work_days[0] ?? 0);
  const dates = data.work_days.map((d) => add(start, d));
  const me = data.users.find((u) => u.id === session.id);
  const filtered = data.users.filter(
    (u) =>
      (!team || (team === 'none' ? u.team_id === null : u.team_id === team)) &&
      fullName(u)
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('fr')
        .includes(
          search
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLocaleLowerCase('fr'),
        ),
  );
  const groups = [...data.teams, { id: 'none', name: 'Sans équipe' }]
    .map((t) => ({
      ...t,
      users: filtered
        .filter((u) => (u.team_id ?? 'none') === t.id)
        .sort((a, b) =>
          a.id === session.id
            ? -1
            : b.id === session.id
              ? 1
              : a.last_name.localeCompare(b.last_name, 'fr'),
        ),
    }))
    .filter((t) => t.users.length);
  const missing = dates.reduce(
    (sum, date) =>
      sum +
      halves.filter((h) => entry(data, session.id, date, h).status === 'none')
        .length,
    0,
  );
  // Stryker disable OptionalChaining: Selections originate from current users and are cleared on refresh or view changes, so a displayed toolbar always has its user.
  const selectedName =
    selection &&
    data.users.find((user) => user.id === selection.user)?.first_name;
  // Stryker restore OptionalChaining
  function applySelection(selected: Selection, value: Presence) {
    const slots = dates
      .flatMap((date) => halves.map((half) => ({ date, half, ...value })))
      .slice(
        Math.min(selected.anchor, selected.end),
        Math.max(selected.anchor, selected.end) + 1,
      );
    void action(() => saveEntries(session.csrf, selected.user, slots));
  }
  function cell(user: Person, date: string, half: Half, index: number) {
    const value = entry(data, user.id, date, half);
    const editable = admin || user.id === session.id;
    const selected =
      selection?.user === user.id &&
      index >= Math.min(selection.anchor, selection.end) &&
      index <= Math.max(selection.anchor, selection.end);
    return (
      <button
        key={half}
        type="button"
        disabled={busy}
        className={`presence presence-${value.status}${selected ? ' presence-selected' : ''}`}
        style={{
          opacity: location && value.location_id !== location ? 0.35 : 1,
        }}
        aria-label={`${fullName(user)} · ${formatted(date)} · ${half === 'am' ? 'Matin' : 'Après-midi'} : ${description(value, data.locations)}`}
        title={value.note || description(value, data.locations)}
        aria-pressed={selected}
        onPointerDown={(e) => {
          moved.current = false;
          if (!editable || e.button !== 0 || e.pointerType === 'touch') return;
          const pending = {
            user: user.id,
            anchor:
              e.shiftKey && selection?.user === user.id
                ? selection.anchor
                : index,
            end: index,
          };
          drag.current = pending;
          setSelection(e.shiftKey ? pending : null);
        }}
        onPointerEnter={() => {
          const pending = drag.current;
          if (pending?.user === user.id && pending.end !== index) {
            moved.current = true;
            const next = { ...pending, end: index };
            drag.current = next;
            setSelection(next);
          }
        }}
        onClick={(e) => {
          if (moved.current && e.detail > 0) return;
          if (e.shiftKey && editable) {
            setSelection({
              user: user.id,
              anchor: selection?.user === user.id ? selection.anchor : index,
              end: index,
            });
            return;
          }
          open(user, date);
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' && e.shiftKey && editable) {
            e.preventDefault();
            setSelection({
              user: user.id,
              anchor: selection?.user === user.id ? selection.anchor : index,
              end: index,
            });
          }
        }}
      >
        <span>
          {value.status === 'office'
            ? data.locations.find((l) => l.id === value.location_id)?.code
            : labels[value.status]}
        </span>
        {value.note && <span aria-label="Note"> •</span>}
      </button>
    );
  }
  return (
    <section
      className="planning"
      aria-label={view === 'config' ? 'Configuration' : 'Présences'}
    >
      {view !== 'locations' && (
        <h2>
          {view === 'planning'
            ? 'Planning de l’équipe'
            : view === 'me'
              ? 'Ma semaine'
              : 'Configuration'}
        </h2>
      )}
      {error && !editing && (
        <p role="alert" className="error">
          {error} <button onClick={reload}>Réessayer</button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {view !== 'config' && (
        <div className="week-navigation">
          <button
            disabled={busy}
            onClick={() => {
              navigate(add(start, -7));
            }}
          >
            Semaine précédente
          </button>
          <strong>
            {formatted(dates[0] ?? start)} –{' '}
            {formatted(dates[dates.length - 1] ?? start)}
          </strong>
          <button
            disabled={busy}
            onClick={() => {
              navigate(add(start, 7));
            }}
          >
            Semaine suivante
          </button>
          <button
            disabled={busy}
            onClick={() => {
              navigate(currentWeek());
            }}
          >
            Cette semaine
          </button>
        </div>
      )}
      {view === 'config' && admin && (
        <section className="workspace-card">
          <h3>Jours affichés dans le planning</h3>
          <p>
            Ces jours s’appliquent au planning, à Ma semaine, à la semaine type
            et à l’occupation des lieux.
          </p>
          <fieldset disabled={busy}>
            <legend>Jours travaillés</legend>
            {days.map((label, i) => (
              <label key={label} className="day-option">
                <input
                  type="checkbox"
                  checked={data.work_days.includes(i)}
                  disabled={
                    data.work_days.length === 1 && data.work_days.includes(i)
                  }
                  onChange={() => {
                    const next = data.work_days.includes(i)
                      ? data.work_days.filter((d) => d !== i)
                      : [...data.work_days, i].sort((a, b) => a - b);
                    void action(() =>
                      save('settings', session.csrf, { work_days: next }),
                    );
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="workspace-actions">
            {[
              { label: 'Lun – Ven', value: [0, 1, 2, 3, 4] },
              { label: 'Lun – Sam', value: [0, 1, 2, 3, 4, 5] },
              { label: 'Mar – Sam', value: [1, 2, 3, 4, 5] },
              { label: '7 j / 7', value: [0, 1, 2, 3, 4, 5, 6] },
            ].map((preset) => (
              <button
                key={preset.label}
                disabled={busy}
                aria-pressed={preset.value.join() === data.work_days.join()}
                onClick={() => {
                  void action(() =>
                    save('settings', session.csrf, { work_days: preset.value }),
                  );
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p>
            {data.work_days.length} jour(s) affiché(s) :{' '}
            {data.work_days.map((d) => days[d]).join(', ')}.
          </p>
        </section>
      )}
      {view === 'planning' && (
        <>
          {missing > 0 && (
            <p>
              {missing} demi-journée(s) non renseignée(s) dans votre semaine.{' '}
              <button onClick={goMe}>Renseigner ma semaine</button>
            </p>
          )}
          <div className="workspace-filters">
            <label>
              Rechercher un collaborateur
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </label>
            <label>
              Équipe
              <select
                value={team}
                onChange={(e) => {
                  setTeam(e.target.value);
                }}
              >
                <option value="">Toutes les équipes</option>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="none">Sans équipe</option>
              </select>
            </label>
            <label>
              Lieu
              <select
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                }}
              >
                <option value="">Tous les lieux</option>
                {data.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="presence-legend">
            {Object.entries(labels).map(([status, label]) => (
              <li className={`presence-${status}`} key={status}>
                {label}
              </li>
            ))}
          </ul>
          {!filtered.length && (
            <p>Aucun collaborateur ne correspond à ces critères.</p>
          )}
          <div className="desktop-planning">
            <table>
              <caption>Présences par demi-journée</caption>
              <thead>
                <tr>
                  <th scope="col">Collaborateur</th>
                  {dates.map((date, i) => (
                    <th scope="col" key={date}>
                      {days[data.work_days[i] ?? 0]}{' '}
                      {new Date(`${date}T12:00:00`).getDate()}
                      <small>
                        {
                          filtered.filter((u) => {
                            const p = entry(data, u.id, date, 'am');
                            return (
                              p.status === 'office' &&
                              (!location || p.location_id === location)
                            );
                          }).length
                        }{' '}
                        sur site le matin
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Group
                    key={group.id}
                    name={group.name}
                    columns={dates.length + 1}
                  >
                    {group.users.map((user) => (
                      <tr key={user.id}>
                        <th scope="row">
                          {fullName(user)}
                          {user.id === session.id && ' (vous)'}
                        </th>
                        {dates.map((date, i) => (
                          <td key={date}>
                            <div className="presence-halves">
                              {halves.map((half, h) =>
                                cell(user, date, half, 2 * i + h),
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Group>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(view === 'locations' || view === 'planning') && (
        <div className={view === 'planning' ? 'mobile-planning' : undefined}>
          <div className="workspace-actions" aria-label="Jour affiché">
            {data.work_days.map((d) => (
              <button
                key={d}
                aria-pressed={day === d}
                onClick={() => {
                  setSelectedDay(d);
                }}
              >
                {days[d]} {new Date(`${add(start, d)}T12:00:00`).getDate()}
              </button>
            ))}
          </div>
          {view === 'planning' && (
            <>
              <div className="workspace-actions">
                {halves.map((h) => (
                  <button
                    key={h}
                    aria-pressed={selectedHalf === h}
                    onClick={() => {
                      setSelectedHalf(h);
                    }}
                  >
                    {h === 'am' ? 'Matin' : 'Après-midi'}
                  </button>
                ))}
              </div>
              {[
                ...data.locations.map((l) => ({
                  key: `office:${l.id}`,
                  title: `Bureau · ${l.name}`,
                })),
                ...(['remote', 'travel', 'off', 'none'] as const).map((s) => ({
                  key: s,
                  title: labels[s],
                })),
              ].map((group) => {
                const people = filtered.filter((user) => {
                  const p = entry(data, user.id, add(start, day), selectedHalf);
                  return (
                    (p.status === 'office'
                      ? `office:${p.location_id}`
                      : p.status) === group.key
                  );
                });
                return (
                  people.length > 0 && (
                    <section className="workspace-card" key={group.key}>
                      <h3>
                        {group.title} · {people.length}
                      </h3>
                      {people.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => {
                            open(user, add(start, day));
                          }}
                        >
                          {fullName(user)}{' '}
                          {
                            entry(data, user.id, add(start, day), selectedHalf)
                              .note
                          }
                        </button>
                      ))}
                    </section>
                  )
                );
              })}
            </>
          )}
        </div>
      )}
      {view === 'locations' && (
        <Occupancy week={data} day={day} renderLocation={renderLocation} />
      )}
      {view === 'me' && me && (
        <MyWeek
          week={data}
          me={me}
          csrf={session.csrf}
          busy={busy}
          edit={(date) => {
            open(me, date);
          }}
          write={(date, value) => {
            write(me.id, date, { am: value, pm: value });
          }}
          action={(task) => {
            void action(task);
          }}
        />
      )}
      {selection && (
        <aside className="selection-bar" aria-label="Modifier la sélection">
          <strong>
            {Math.abs(selection.end - selection.anchor) + 1} demi-journée(s) ·{' '}
            {selectedName}
          </strong>
          {data.locations.map((l) => (
            <button
              key={l.id}
              disabled={busy}
              onClick={() => {
                applySelection(selection, {
                  status: 'office',
                  location_id: l.id,
                  note: '',
                });
              }}
            >
              Bureau · {l.name}
            </button>
          ))}
          {(['remote', 'travel', 'off'] as const).map((status) => (
            <button
              key={status}
              disabled={busy}
              onClick={() => {
                applySelection(selection, {
                  status,
                  location_id: null,
                  note: '',
                });
              }}
            >
              {labels[status]}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => {
              applySelection(selection, empty);
            }}
          >
            Effacer
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setSelection(null);
            }}
          >
            Annuler la sélection
          </button>
        </aside>
      )}
      {editing && (
        <PresenceEditor
          editing={editing}
          week={data}
          canEdit={admin || editing.user.id === session.id}
          busy={busy}
          error={error}
          close={() => {
            setEditing(null);
          }}
          submit={(values) => {
            write(editing.user.id, editing.date, values);
          }}
        />
      )}
    </section>
  );
}
function Group({
  name,
  columns,
  children,
}: {
  name: string;
  columns: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="planning-team">
        <th colSpan={columns}>{name}</th>
      </tr>
      {children}
    </>
  );
}
