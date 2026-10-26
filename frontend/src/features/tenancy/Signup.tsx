import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, errorMessage, request, string } from '../../shared/api';
import type { Configuration } from '../../shared/api';
import { Field, formText } from '../../shared/Field';

export function Availability({ slug }: { slug: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      if (!slug) {
        setMessage('');
        return;
      }
      setMessage('Vérification…');
      void request(`/tenants/availability?slug=${encodeURIComponent(slug)}`)
        .then((data) => {
          if (typeof data['available'] !== 'boolean') throw new Error();
          if (current)
            setMessage(
              data['available']
                ? 'Cet espace est disponible.'
                : 'Cet espace est indisponible.',
            );
        })
        .catch(() => {
          if (current) setMessage('Impossible de vérifier cet espace.');
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [slug]);
  return (
    <p className="availability" role="status">
      {message}
    </p>
  );
}
export function Signup({ config }: { config: Configuration }) {
  const [slug, setSlug] = useState('');
  const [receipt, setReceipt] = useState(() =>
    sessionStorage.getItem('registration-receipt'),
  );
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
      const result = await request('/registrations', {
        first_name: formText(data, 'first_name'),
        last_name: formText(data, 'last_name'),
        slug,
        email: formText(data, 'email'),
        password: formText(data, 'password'),
        accepted_terms: data.has('accepted_terms'),
        terms_version: config.termsVersion,
      });
      const receipt = string(result['receipt']);
      sessionStorage.setItem('registration-receipt', receipt);
      setReceipt(receipt);
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <RegistrationStatus
        receipt={receipt}
        onRestart={() => {
          sessionStorage.removeItem('registration-receipt');
          setReceipt(null);
        }}
      />
    );
  return (
    <form
      className="card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div>
        <h2>Créer un compte</h2>
        <p>Créez l’espace de présence de votre équipe.</p>
      </div>
      <div className="name-row">
        <Field
          label="Prénom"
          name="first_name"
          autoComplete="given-name"
          required
          maxLength={100}
          error={fields['first_name']}
        />
        <Field
          label="Nom"
          name="last_name"
          autoComplete="family-name"
          required
          maxLength={100}
          error={fields['last_name']}
        />
      </div>
      <Field
        label="Espace d’entreprise"
        name="slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value.toLowerCase())}
        required
        minLength={3}
        maxLength={63}
        pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
        suffix={`.${config.rootDomain}`}
        error={fields['slug']}
      />
      <Availability slug={slug} />
      <Field
        label="Email professionnel"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fields['email']}
      />
      <Field
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={128}
        error={fields['password']}
      />
      <p className="hint">
        Entre 8 et 128 caractères, avec une minuscule, une majuscule, un chiffre
        et un caractère spécial.
      </p>
      <label className="checkbox">
        <input
          name="accepted_terms"
          type="checkbox"
          required
          aria-describedby={
            fields['accepted_terms'] ? 'terms-error' : undefined
          }
        />
        <span>
          J’accepte les <a href="/terms">conditions d’utilisation</a> et la{' '}
          <a href="/privacy">politique de confidentialité</a> provisoires.
        </span>
      </label>
      {fields['accepted_terms'] && (
        <span className="field-error" id="terms-error">
          {fields['accepted_terms']}
        </span>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Création…' : 'Créer mon espace'}
      </button>
      <p className="center">
        Déjà un compte ? <a href="/login">Se connecter</a>
      </p>
    </form>
  );
}
export function RegistrationStatus({
  receipt,
  onRestart,
}: {
  receipt: string;
  onRestart?: () => void;
}) {
  const [status, setStatus] = useState('pending');
  const [origin, setOrigin] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await request('/registrations/status', undefined, {
          Authorization: `Bearer ${receipt}`,
        });
        if (!current) return;
        const status = string(data['state']);
        setStatus(status);
        setOrigin(string(data['origin']));
        setStatusError('');
        if (!['active', 'expired'].includes(status))
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      } catch (error) {
        if (current) {
          setStatusError(errorMessage(error));
          timer = setTimeout(() => {
            void poll();
          }, 2000);
        }
      }
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [receipt]);
  async function resend() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await request(
        '/registrations/resend',
        {},
        { Authorization: `Bearer ${receipt}` },
      );
      setMessage('Un nouvel email de vérification a été envoyé.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>
        {status === 'active'
          ? 'Votre espace est prêt'
          : status === 'pending'
            ? 'Vérifiez votre email'
            : status === 'expired'
              ? 'Réservation expirée'
              : 'Création de votre espace'}
      </h2>
      <p role="status">
        {status === 'pending'
          ? 'Un email vous a été envoyé. Ouvrez le lien et confirmez l’activation de votre entreprise.'
          : status === 'active'
            ? 'Vous pouvez maintenant vous connecter.'
            : status === 'expired'
              ? 'Créez une nouvelle inscription pour réserver votre espace.'
              : 'Votre adresse est confirmée. Nous préparons votre entreprise, cette page se met à jour automatiquement.'}
      </p>
      {status === 'pending' && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            void resend();
          }}
        >
          {busy ? 'Envoi…' : 'Renvoyer l’email'}
        </button>
      )}
      {status === 'active' && (
        <a className="primary button-link" href={`${origin}/login`}>
          Accéder à mon espace
        </a>
      )}
      {message && <p role="status">{message}</p>}
      {(error || statusError) && (
        <p role="alert" className="error">
          {error || statusError}
        </p>
      )}
      {onRestart && (
        <button className="text-button" onClick={onRestart}>
          Nouvelle inscription
        </button>
      )}
    </section>
  );
}
