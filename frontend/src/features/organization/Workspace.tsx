import { useEffect, useState } from 'react';
import { Planning } from '../planning';
import type { PlanningView } from '../planning';
import { errorMessage } from '../../shared/api';
import { load, mutate } from './api';
import type { Member } from './api';
import { Dialog } from './Dialog';
import { Editor } from './Editor';
import type { Editing } from './Editor';

interface Session {
  id: string;
  company: string;
  first_name: string;
  last_name: string;
  role: string;
  csrf: string;
}
const labels = {
  pending: 'Invitation en attente',
  active: 'Actif',
  inactive: 'Désactivé',
};
export function Workspace({
  session,
  logout,
  logoutBusy,
  refreshSession,
}: {
  session: Session;
  logout: () => void;
  logoutBusy: boolean;
  refreshSession: () => void;
}) {
  const admin = session.role === 'admin';
  const [tab, setTab] = useState<PlanningView | 'company' | 'users'>(
    'planning',
  );
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(
    null,
  );
  const [revision, setRevision] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    path: string;
    method: 'DELETE' | 'PATCH';
    body?: Member;
    self?: boolean;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void load(admin)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((error: unknown) => {
        if (current) setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [admin, revision]);
  function personalWeek() {
    setTab('me');
  }
  function reload() {
    setError('');
    setRevision({});
  }
  async function action(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown = {},
    self = false,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(path, session.csrf, method, body);
      setConfirmation(null);
      setNotice('Modification enregistrée.');
      if (self) refreshSession();
      else reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const team =
    data?.teams.find((team) => team.id === selected) ?? data?.teams[0];
  // Stryker disable ArrayDeclaration: The fallback is used only while data is absent and member content is not rendered.
  const members = data?.users.filter((user) => user.team_id === team?.id) ?? [];
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: The fallback is used only while data is absent and user content is not rendered.
  const users =
    data?.users.filter(
      (user) =>
        `${user.first_name} ${user.last_name} ${user.email}`
          .toLocaleLowerCase('fr')
          .includes(search.toLocaleLowerCase('fr')) &&
        (!teamFilter ||
          (teamFilter === 'none'
            ? user.team_id === null
            : user.team_id === teamFilter)) &&
        (!statusFilter || user.status === statusFilter),
    ) ?? [];
  // Stryker restore ArrayDeclaration
  function editUser(user: Member) {
    setEditing({ kind: 'user', value: user });
  }
  function userActions(user: Member) {
    return (
      <div className="workspace-actions">
        <button
          onClick={() => {
            editUser(user);
          }}
        >
          Modifier
          <span className="sr-only">
            {' '}
            {user.first_name} {user.last_name}
          </span>
        </button>
        {user.status === 'pending' && (
          <button
            disabled={busy}
            onClick={() => {
              void action(`/users/${user.id}/invitation`, 'POST');
            }}
          >
            Renvoyer l’invitation
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => {
            setConfirmation({
              title: `${user.status === 'inactive' ? 'Réactiver' : 'Désactiver'} ${user.first_name} ${user.last_name} ?`,
              path: `/users/${user.id}`,
              method: 'PATCH',
              body: {
                ...user,
                status: user.status === 'inactive' ? 'active' : 'inactive',
                email: user.pending_email ?? user.email,
              },
              self: user.id === session.id,
            });
          }}
        >
          {user.status === 'inactive' ? 'Réactiver' : 'Désactiver'}
        </button>
      </div>
    );
  }
  return (
    <section className="workspace" aria-label="Espace entreprise">
      <div className="workspace-heading">
        <div>
          <h1>{session.company}</h1>
          <p>
            Bonjour {session.first_name} {session.last_name} ·{' '}
            {admin ? 'Administrateur' : 'Collaborateur'}
          </p>
        </div>
        <button disabled={logoutBusy} onClick={logout}>
          {logoutBusy ? 'Déconnexion…' : 'Se déconnecter'}
        </button>
      </div>
      <nav className="workspace-tabs" aria-label="Espace entreprise">
        <button
          aria-current={tab === 'planning' ? 'page' : undefined}
          onClick={() => {
            setTab('planning');
          }}
        >
          Planning
        </button>
        <button
          aria-current={tab === 'me' ? 'page' : undefined}
          onClick={() => {
            setTab('me');
          }}
        >
          Ma semaine
        </button>
        {admin && (
          <button
            aria-current={tab === 'config' ? 'page' : undefined}
            onClick={() => {
              setTab('config');
            }}
          >
            Configuration
          </button>
        )}
        <button
          aria-current={tab === 'locations' ? 'page' : undefined}
          onClick={() => {
            setTab('locations');
          }}
        >
          Lieux
        </button>
        {admin && (
          <>
            <button
              aria-current={tab === 'company' ? 'page' : undefined}
              onClick={() => {
                setTab('company');
              }}
            >
              Entreprise
            </button>
            <button
              aria-current={tab === 'users' ? 'page' : undefined}
              onClick={() => {
                setTab('users');
              }}
            >
              Utilisateurs
            </button>
          </>
        )}
      </nav>
      {error && !confirmation && (
        <div role="alert" className="error">
          {error} <button onClick={reload}>Réessayer</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        !error && <p role="status">Chargement…</p>
      ) : (
        <>
          {(tab === 'planning' || tab === 'me' || tab === 'config') && (
            <Planning view={tab} session={session} goMe={personalWeek} />
          )}
          {tab === 'locations' && (
            <>
              <div className="workspace-heading">
                <div>
                  <h2>Lieux de travail</h2>
                  <p>Les lieux de présence de votre entreprise.</p>
                </div>
                {admin && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditing({ kind: 'location' });
                    }}
                  >
                    Ajouter un lieu
                  </button>
                )}
              </div>
              {!data.locations.length && (
                <p>
                  Aucun lieu.{' '}
                  {admin
                    ? 'Ajoutez un premier lieu de présence.'
                    : 'Votre administrateur peut définir les lieux de présence.'}
                </p>
              )}
              <Planning
                key={data.locations.map((l) => `${l.id}${l.name}`).join()}
                view="locations"
                session={session}
                goMe={personalWeek}
                renderLocation={(id) => {
                  const location = data.locations.find((l) => l.id === id);
                  return location ? (
                    <div>
                      <span className="location-code">{location.code}</span>
                      <h3>{location.name}</h3>
                      <p>{location.city}</p>
                      <p>{location.address}</p>
                      <p>{location.members} personne(s) rattachée(s)</p>
                      {admin && (
                        <div className="workspace-actions">
                          <button
                            onClick={() => {
                              setEditing({ kind: 'location', value: location });
                            }}
                          >
                            Modifier
                            <span className="sr-only"> {location.name}</span>
                          </button>
                          <button
                            disabled={location.members > 0 || busy}
                            onClick={() => {
                              setConfirmation({
                                title: `Supprimer le lieu « ${location.name} » ?`,
                                path: `/locations/${location.id}`,
                                method: 'DELETE',
                              });
                            }}
                          >
                            Supprimer
                            <span className="sr-only"> {location.name}</span>
                          </button>
                        </div>
                      )}
                      {admin && location.members > 0 && (
                        <p>
                          Suppression impossible : des collaborateurs y sont
                          rattachés.
                        </p>
                      )}
                    </div>
                  ) : null;
                }}
              />
            </>
          )}
          {admin && tab === 'company' && (
            <>
              <div className="workspace-heading">
                <div>
                  <h2>Entreprise</h2>
                  <p>
                    {data.teams.length} équipe(s) · {data.users.length}{' '}
                    utilisateur(s) · {data.locations.length} lieu(x)
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setEditing({ kind: 'team' });
                  }}
                >
                  Nouvelle équipe
                </button>
              </div>
              {!data.teams.length && (
                <p>
                  Aucune équipe. Créez-en une pour y rattacher des
                  collaborateurs.
                </p>
              )}
              <div className="team-layout">
                <aside aria-label="Équipes">
                  {data.teams.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={item === team}
                      onClick={() => {
                        setSelected(item.id);
                      }}
                    >
                      {item.name} · {item.members} membre(s)
                    </button>
                  ))}
                </aside>
                {team && (
                  <section
                    className="workspace-card"
                    aria-label={`Équipe ${team.name}`}
                  >
                    <div className="workspace-heading">
                      <div>
                        <h3>{team.name}</h3>
                        <p>
                          {members.length} membre(s) ·{' '}
                          {
                            members.filter((user) => user.status === 'active')
                              .length
                          }{' '}
                          actif(s)
                        </p>
                      </div>
                      <div className="workspace-actions">
                        <button
                          onClick={() => {
                            setEditing({ kind: 'team', value: team });
                          }}
                        >
                          Modifier l’équipe
                        </button>
                        <button
                          disabled={team.members > 0 || busy}
                          onClick={() => {
                            setConfirmation({
                              title: `Supprimer l’équipe « ${team.name} » ?`,
                              path: `/teams/${team.id}`,
                              method: 'DELETE',
                            });
                          }}
                        >
                          Supprimer l’équipe
                        </button>
                        <button
                          onClick={() => {
                            // Stryker disable next-line StringLiteral: A new member has no ID; both discriminants select the same user form and save path, and cannot refresh the current account.
                            setEditing({ kind: 'user', team: team.id });
                          }}
                        >
                          Inviter un membre
                        </button>
                      </div>
                    </div>
                    {team.members > 0 && (
                      <p>
                        La suppression nécessite de déplacer tous les membres.
                      </p>
                    )}
                    <label>
                      Déplacer un membre vers cette équipe
                      <select
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          const user = data.users.find(
                            (user) => user.id === event.target.value,
                          );
                          if (user)
                            void action(`/users/${user.id}`, 'PATCH', {
                              ...user,
                              email: user.pending_email ?? user.email,
                              team_id: team.id,
                            });
                        }}
                      >
                        <option value="">Choisir un collaborateur…</option>
                        {data.users
                          .filter((user) => user.team_id !== team.id)
                          .map((user) => (
                            <option value={user.id} key={user.id}>
                              {user.first_name} {user.last_name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!members.length && (
                      <p>Aucun membre dans cette équipe pour l’instant.</p>
                    )}
                    {members.map((user) => (
                      <article className="member-row" key={user.id}>
                        <div>
                          <strong>
                            {user.first_name} {user.last_name}
                          </strong>
                          <p>
                            {user.email} · {labels[user.status]}
                          </p>
                        </div>
                        <label>
                          Équipe de {user.first_name} {user.last_name}
                          <select
                            value={user.team_id ?? undefined}
                            disabled={busy}
                            onChange={(event) => {
                              void action(`/users/${user.id}`, 'PATCH', {
                                ...user,
                                email: user.pending_email ?? user.email,
                                team_id: event.target.value || null,
                              });
                            }}
                          >
                            <option value="">Sans équipe</option>
                            {data.teams.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          onClick={() => {
                            editUser(user);
                          }}
                        >
                          Modifier
                          <span className="sr-only">
                            {' '}
                            {user.first_name} {user.last_name}
                          </span>
                        </button>
                      </article>
                    ))}
                  </section>
                )}
              </div>
            </>
          )}
          {admin && tab === 'users' && (
            <>
              <div className="workspace-heading">
                <div>
                  <h2>Utilisateurs</h2>
                  <p>Gérez les comptes, équipes et rattachements.</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setEditing({ kind: 'user' });
                  }}
                >
                  Ajouter un utilisateur
                </button>
              </div>
              <div className="workspace-filters">
                <label>
                  Rechercher
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                    placeholder="Nom ou email"
                  />
                </label>
                <label>
                  Équipe
                  <select
                    value={teamFilter}
                    onChange={(event) => {
                      setTeamFilter(event.target.value);
                    }}
                  >
                    <option value="">Toutes les équipes</option>
                    <option value="none">Sans équipe</option>
                    {data.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Statut
                  <select
                    value={statusFilter}
                    onChange={(event) => {
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="">Tous les statuts</option>
                    <option value="pending">Invitation en attente</option>
                    <option value="active">Actif</option>
                    <option value="inactive">Désactivé</option>
                  </select>
                </label>
              </div>
              {!users.length && (
                <p>Aucun utilisateur ne correspond à ces critères.</p>
              )}
              {users.map((user) => (
                <article className="workspace-card member-row" key={user.id}>
                  <div>
                    <h3>
                      {user.first_name} {user.last_name}
                    </h3>
                    <p>{user.email}</p>
                    {user.pending_email && (
                      <p>Confirmation en attente : {user.pending_email}</p>
                    )}
                    <p>
                      {user.role === 'admin'
                        ? 'Administrateur'
                        : 'Collaborateur'}{' '}
                      · {labels[user.status]}
                    </p>
                    <p>
                      {data.teams.find((team) => team.id === user.team_id)
                        ?.name ?? 'Sans équipe'}{' '}
                      ·{' '}
                      {data.locations.find(
                        (location) => location.id === user.location_id,
                      )?.name ?? 'Sans lieu habituel'}
                    </p>
                  </div>
                  {userActions(user)}
                </article>
              ))}
            </>
          )}
          {editing && (
            <Editor
              editing={editing}
              locations={data.locations}
              teams={data.teams}
              csrf={session.csrf}
              close={() => {
                setEditing(null);
              }}
              saved={() => {
                const self =
                  editing.kind === 'user' && editing.value?.id === session.id;
                setEditing(null);
                setNotice('Modification enregistrée.');
                reload();
                if (self) refreshSession();
              }}
            />
          )}
        </>
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          busy={busy}
          close={() => {
            setConfirmation(null);
          }}
          alert
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="workspace-actions">
            <button
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
              }}
            >
              Annuler
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void action(
                  confirmation.path,
                  confirmation.method,
                  confirmation.body,
                  confirmation.self,
                );
              }}
            >
              {busy ? 'Enregistrement…' : 'Confirmer'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
