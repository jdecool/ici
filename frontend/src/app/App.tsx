import { useEffect, useState } from 'react';
import { Identity } from '../features/identity';
import { configuration, errorMessage } from '../shared/api';
import type { Configuration } from '../shared/api';
import './style.css';

function Preview() {
  const rows = [
    {
      name: 'Camille',
      days: ['office', 'office', 'remote', 'office', 'remote'],
    },
    {
      name: 'Lucas',
      days: ['remote', 'office', 'remote', 'office', 'unknown'],
    },
    { name: 'Inès', days: ['office', 'office', 'remote', 'office', 'remote'] },
  ];
  return (
    <div className="preview">
      <table aria-label="Aperçu illustratif du planning de présence">
        <thead>
          <tr className="week week-head">
            <th aria-hidden="true" />
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map((day) => (
              <th scope="col" key={day}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="week" key={row.name}>
              <th scope="row">{row.name}</th>
              {row.days.map((day, index) => (
                <td
                  key={index}
                  className="day"
                  data-status={day}
                  aria-label={
                    day === 'office'
                      ? 'Présentiel'
                      : day === 'remote'
                        ? 'Distanciel'
                        : 'Non renseigné'
                  }
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend">
        <span>
          <i className="office" />
          Présentiel
        </span>
        <span>
          <i className="remote" />
          Distanciel
        </span>
        <span>
          <i className="unknown" />
          Non renseigné
        </span>
      </div>
    </div>
  );
}

function Legal({ privacy }: { privacy: boolean }) {
  return (
    <article className="card legal">
      <h1>
        {privacy ? 'Politique de confidentialité' : 'Conditions d’utilisation'}
      </h1>
      <p className="error">
        Document provisoire — version 2026-10-draft. À remplacer avant toute
        ouverture publique.
      </p>
      {privacy ? (
        <>
          <p>
            Ce prototype utilise votre nom, votre email, le nom de votre
            entreprise et vos données d’authentification pour créer et sécuriser
            votre espace. Les comptes sont indépendants pour chaque entreprise.
          </p>
          <p>
            Un cookie de session strictement nécessaire permet de rester
            connecté. Aucun suivi publicitaire n’est prévu. Les mots de passe
            sont conservés sous forme de hash ; les liens de vérification et de
            récupération expirent.
          </p>
          <p>
            Les durées de conservation définitives, l’identité du responsable du
            traitement, sa base légale, les sous-traitants et le contact pour
            exercer vos droits doivent être précisés avant l’ouverture publique.
          </p>
        </>
      ) : (
        <>
          <p>
            Ici est un prototype permettant de créer un espace d’entreprise et
            de gérer l’accès à cet espace. Le planning présenté sur la page
            d’accueil est une illustration.
          </p>
          <p>
            En créant un compte, vous confirmez disposer d’une adresse email
            valide et acceptez de protéger vos identifiants. Le créateur de
            l’espace en devient administrateur.
          </p>
          <p>
            La version acceptée et la date de consentement sont enregistrées.
            L’identité de l’éditeur, les modalités de service, de résiliation et
            de responsabilité doivent être complétées avant l’ouverture
            publique.
          </p>
        </>
      )}
      <a href="/signup">Retour à l’inscription</a>
    </article>
  );
}
export function App() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [error, setError] = useState('');
  const path = window.location.pathname;
  useEffect(
    () => {
      let current = true;
      void configuration()
        .then((config) => {
          if (current) setConfig(config);
        })
        .catch((error: unknown) => {
          if (current) setError(errorMessage(error));
        });
      return () => {
        current = false;
      };
    },
    // Stryker disable next-line ArrayDeclaration: A constant sentinel and an empty dependency list both stay stable across renders.
    [],
  );
  const legal = path === '/terms' || path === '/privacy';
  return (
    <div className="shell">
      <header>
        <div className="header-content">
          <a href="/" className="brand" aria-label="Ici — accueil">
            <span className="logo">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M12 22s-7.5-6.6-7.5-12.6a7.5 7.5 0 0 1 15 0C19.5 15.4 12 22 12 22z"
                  fill="white"
                />
                <circle cx="12" cy="9.4" r="2.9" fill="#1B2140" />
              </svg>
            </span>
            Ici
          </a>
        </div>
      </header>
      <main className={legal ? 'legal-main' : 'landing'}>
        {legal ? (
          <Legal privacy={path === '/privacy'} />
        ) : (
          <>
            <section className="pitch">
              <div className="eyebrow">Planning de présence d’équipe</div>
              <h1>Sachez qui est au bureau avant de vous déplacer.</h1>
              <p>
                Chacun indique sa semaine en quelques clics : présentiel,
                distanciel ou absence. Toute l’équipe voit en un coup d’œil
                quand se retrouver.
              </p>
              <Preview />
            </section>
            <div className="form-column">
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : config ? (
                <Identity config={config} path={path} />
              ) : (
                <p role="status">Chargement…</p>
              )}
            </div>
          </>
        )}
      </main>
      <footer>
        <span>© Ici — Présences</span>
        <nav aria-label="Informations légales">
          <a href="/terms">Conditions d’utilisation</a>
          <a href="/privacy">Confidentialité</a>
        </nav>
      </footer>
    </div>
  );
}
