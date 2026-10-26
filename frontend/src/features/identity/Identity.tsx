import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, errorMessage, request, string } from '../../shared/api';
import type { Configuration } from '../../shared/api';
import { Field, formText } from '../../shared/Field';
import { Invitation } from './Invitation';
import { Signup, RegistrationStatus } from '../tenancy';

function transfer(code: string, target: string) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = target;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'code';
  input.value = code;
  form.append(input);
  document.body.append(form);
  form.submit();
}
function Login({ config }: { config: Configuration }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setFields({});
    try {
      const slug = config.tenant ?? formText(data, 'slug').toLowerCase();
      const result = await request('/auth/login', {
        slug,
        email: formText(data, 'email'),
        password: formText(data, 'password'),
        remember: data.has('remember'),
      });
      const target = string(result['target']);
      const expected = new URL(config.publicOrigin);
      expected.hostname = `${slug}.${config.rootDomain}`;
      expected.pathname = '/api/auth/handoff';
      if (target !== expected.href) throw new Error();
      transfer(string(result['code']), target);
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
      setBusy(false);
    }
  }
  return (
    <form
      className="card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div>
        <h2>Connexion{config.tenant ? ` — ${config.tenant}` : ''}</h2>
        <p>Accédez au planning de présence de votre équipe.</p>
      </div>
      {!config.tenant && (
        <Field
          label="Espace d’entreprise"
          name="slug"
          required
          minLength={3}
          maxLength={63}
          autoCapitalize="none"
          suffix={`.${config.rootDomain}`}
          error={fields['slug']}
        />
      )}
      <Field
        label="Email professionnel"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="prenom.nom@entreprise.fr"
        required
        error={fields['email']}
      />
      <div className="password-field">
        <div className="forgot-link">
          <a href="/forgot-password">Mot de passe oublié ?</a>
        </div>
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={fields['password']}
        />
      </div>
      <label className="checkbox">
        <input name="remember" type="checkbox" /> Rester connecté
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
      <p className="center">
        Pas encore de compte ?{' '}
        <a href={`${config.publicOrigin}/signup`}>Créer un compte</a>
      </p>
    </form>
  );
}
function Recovery({
  config,
  reset,
}: {
  config: Configuration;
  reset: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setFields({});
    try {
      await request(
        reset ? '/auth/reset-password' : '/auth/forgot-password',
        reset
          ? { token, password: formText(data, 'password') }
          : {
              slug: config.tenant ?? formText(data, 'slug'),
              email: formText(data, 'email'),
            },
      );
      setDone(true);
      if (reset)
        history.replaceState(null, document.title, window.location.pathname);
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{reset ? 'Nouveau mot de passe' : 'Mot de passe oublié'}</h2>
      {done ? (
        <p role="status">
          {reset
            ? 'Votre mot de passe a été modifié. Toutes vos sessions ont été fermées.'
            : 'Si ce compte existe, un email de récupération vous a été envoyé.'}
        </p>
      ) : (
        <>
          <p>
            {reset
              ? 'Choisissez un mot de passe de 15 à 128 caractères.'
              : 'Recevez un lien pour retrouver l’accès à votre espace.'}
          </p>
          {reset ? (
            <Field
              label="Nouveau mot de passe"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
              error={fields['password']}
            />
          ) : (
            <>
              {!config.tenant && (
                <Field
                  label="Espace d’entreprise"
                  name="slug"
                  required
                  suffix={`.${config.rootDomain}`}
                  error={fields['slug']}
                />
              )}
              <Field
                label="Email professionnel"
                name="email"
                type="email"
                autoComplete="email"
                required
                error={fields['email']}
              />
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? 'Envoi…'
              : reset
                ? 'Modifier le mot de passe'
                : 'Envoyer le lien'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <a href="/login">Retour à la connexion</a>
    </form>
  );
}
function Verification() {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  async function verify() {
    setBusy(true);
    setError('');
    try {
      const data = await request('/registrations/verify', { token });
      setReceipt(string(data['receipt']));
      history.replaceState(null, document.title, window.location.pathname);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (receipt) return <RegistrationStatus receipt={receipt} />;
  return (
    <section className="card">
      <h2>Confirmer mon email</h2>
      <p>Confirmez votre adresse pour activer votre entreprise.</p>
      <button
        className="primary"
        disabled={busy || !token}
        onClick={() => {
          void verify();
        }}
      >
        {busy ? 'Activation…' : 'Activer mon entreprise'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!token && (
        <p role="alert">
          Ouvrez le lien reçu par email pour activer votre espace.
        </p>
      )}
      <a href="/signup">Retour à l’inscription</a>
    </section>
  );
}
export interface Session {
  id: string;
  company: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  csrf: string;
}
export type RenderHome = (
  session: Session,
  logout: () => void,
  busy: boolean,
  refresh: () => void,
) => ReactNode;
function Home({
  config,
  renderHome,
}: {
  config: Configuration;
  renderHome: RenderHome | undefined;
}) {
  const [revision, setRevision] = useState({});
  const [session, setSession] = useState<
    | { kind: 'loading' }
    | { kind: 'guest' }
    | { kind: 'authenticated'; user: Session }
  >({ kind: 'loading' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void request('/auth/session')
      .then((data) => {
        const parsed: Session = {
          id: string(data['id']),
          company: string(data['company']),
          email: string(data['email']),
          first_name: string(data['first_name']),
          last_name: string(data['last_name']),
          role: string(data['role']),
          csrf: string(data['csrf']),
        };
        if (parsed.role !== 'admin' && parsed.role !== 'collaborator')
          throw new Error();
        if (current) setSession({ kind: 'authenticated', user: parsed });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.code === 'unauthenticated')
          setSession({ kind: 'guest' });
        else setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [revision]);
  async function logout(csrf: string) {
    setBusy(true);
    setError('');
    try {
      await request('/auth/logout', {}, { 'X-CSRF-Token': csrf });
      setSession({ kind: 'guest' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  let content;
  switch (session.kind) {
    case 'guest':
      return <Login config={config} />;
    case 'loading':
      content = (
        <>
          <h2>Votre espace</h2>
          {!error && <p role="status">Chargement de votre session…</p>}
        </>
      );
      break;
    case 'authenticated': {
      const { user } = session;
      if (renderHome)
        return (
          <>
            {renderHome(
              user,
              () => {
                void logout(user.csrf);
              },
              busy,
              () => {
                setRevision({});
              },
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </>
        );
      content = (
        <>
          <h2>Bienvenue chez {user['company']}</h2>
          <p>
            Bonjour {user['first_name']} {user['last_name']}.
          </p>
          <p>{user['email']}</p>
          <p>
            {user.role === 'admin' ? 'Administrateur' : 'Collaborateur'} de
            l’entreprise {user.company}.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              void logout(string(user['csrf']));
            }}
          >
            {busy ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
        </>
      );
      break;
    }
  }
  return (
    <section className="card">
      {content}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}

export function Identity({
  config,
  path,
  renderHome,
}: {
  config: Configuration;
  path: string;
  renderHome?: RenderHome;
}) {
  switch (path) {
    case '/accept-invitation':
    case '/confirm-email':
      return config.tenant ? (
        <Invitation
          termsVersion={config.termsVersion}
          emailChange={path === '/confirm-email'}
        />
      ) : (
        <Login config={config} />
      );
    case '/signup':
      return config.tenant ? (
        <Login config={config} />
      ) : (
        <Signup config={config} />
      );
    case '/verify':
      return <Verification />;
    case '/forgot-password':
      return <Recovery config={config} reset={false} />;
    case '/reset-password':
      return <Recovery config={config} reset />;
    case '/login':
      return <Login config={config} />;
    case '/':
      return config.tenant ? (
        <Home config={config} renderHome={renderHome} />
      ) : (
        <Login config={config} />
      );
    default:
      return (
        <section className="card">
          <h2>Page introuvable</h2>
          <a href="/">Retour à l’accueil</a>
        </section>
      );
  }
}
