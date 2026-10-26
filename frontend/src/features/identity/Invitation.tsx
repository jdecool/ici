import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, errorMessage, request } from '../../shared/api';
import { Field, formText } from '../../shared/Field';

export function Invitation({
  termsVersion,
  emailChange,
}: {
  termsVersion: string;
  emailChange: boolean;
}) {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setFields({});
    try {
      await request(
        emailChange ? '/auth/confirm-email' : '/auth/accept-invitation',
        emailChange
          ? { token }
          : {
              token,
              password: formText(data, 'password'),
              accepted_terms: data.has('accepted_terms'),
              terms_version: termsVersion,
            },
      );
      history.replaceState(null, document.title, window.location.pathname);
      setDone(true);
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
      <h2>
        {emailChange
          ? 'Confirmer mon adresse email'
          : 'Rejoindre mon entreprise'}
      </h2>
      {done ? (
        <>
          <p role="status">
            {emailChange
              ? 'Votre adresse email a été modifiée. Reconnectez-vous avec votre nouvelle adresse.'
              : 'Votre compte est activé. Vous pouvez vous connecter.'}
          </p>
          <a href="/login">Se connecter</a>
        </>
      ) : !token ? (
        <p role="alert">Ouvrez le lien reçu par email pour continuer.</p>
      ) : (
        <>
          {emailChange ? (
            <p>
              Confirmez cette nouvelle adresse pour l’utiliser lors de vos
              prochaines connexions.
            </p>
          ) : (
            <>
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
              <p>
                Entre 8 et 128 caractères, avec une minuscule, une majuscule, un
                chiffre et un caractère spécial.
              </p>
              <label className="checkbox">
                <input name="accepted_terms" type="checkbox" required />
                J’accepte les{' '}
                <a href="/terms" target="_blank" rel="noreferrer">
                  conditions d’utilisation
                </a>
                .
              </label>
              {fields['accepted_terms'] && (
                <p className="error">{fields['accepted_terms']}</p>
              )}
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? 'Confirmation…'
              : emailChange
                ? 'Confirmer mon adresse'
                : 'Activer mon compte'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
