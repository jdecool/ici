import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { Identity } from './Identity';
import type { Configuration } from '../../shared/api';

const config: Configuration = {
  rootDomain: 'ici.localhost',
  publicOrigin: 'http://ici.localhost:5173',
  tenant: null,
  termsVersion: '2026-10-draft',
};
const user = {
  company: 'acme',
  email: 'owner@example.com',
  first_name: 'Camille',
  last_name: 'Durand',
  role: 'admin',
  csrf: 'csrf-token',
};
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => vi.restoreAllMocks());
function submit(name: string) {
  const button = screen.getByRole('button', { name });
  const form = button.closest('form');
  if (!form) throw new Error('missing form');
  expect(fireEvent.submit(form)).toBe(false);
}
it('posts credentials then transfers the one-use code with a form POST', async () => {
  const post = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(() => undefined);
  server.use(
    http.post('/api/auth/login', async ({ request }) => {
      expect(await request.json()).toEqual({
        slug: 'acme',
        email: 'owner@example.com',
        password: 'a secure pass phrase',
        remember: true,
      });
      return HttpResponse.json({
        code: 'one-use-code',
        target: 'http://acme.ici.localhost:5173/api/auth/handoff',
      });
    }),
  );
  render(<Identity config={config} path="/login" />);
  expect(screen.getByRole('link', { name: 'Créer un compte' })).toHaveAttribute(
    'href',
    'http://ici.localhost:5173/signup',
  );
  fireEvent.change(screen.getByLabelText('Espace d’entreprise'), {
    target: { value: 'ACME' },
  });
  fireEvent.change(screen.getByLabelText('Email professionnel'), {
    target: { value: 'owner@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Mot de passe'), {
    target: { value: 'a secure pass phrase' },
  });
  fireEvent.click(screen.getByLabelText('Rester connecté'));
  submit('Se connecter');
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  const forms = document.querySelectorAll('form');
  const form = forms.item(forms.length - 1);
  expect(form).toHaveAttribute('method', 'POST');
  expect(form).toHaveAttribute(
    'action',
    'http://acme.ici.localhost:5173/api/auth/handoff',
  );
  expect(form.querySelector('input')).toHaveValue('one-use-code');
  form.remove();
});
it('determines the workspace from the host configuration', async () => {
  server.use(
    http.post('/api/auth/login', async ({ request }) => {
      expect(await request.json()).toMatchObject({
        slug: 'acme',
        remember: false,
      });
      return HttpResponse.json(
        { code: 'invalid_credentials', fields: { email: 'invalid' } },
        { status: 401 },
      );
    }),
  );
  render(<Identity config={{ ...config, tenant: 'acme' }} path="/login" />);
  expect(
    screen.queryByLabelText('Espace d’entreprise'),
  ).not.toBeInTheDocument();
  submit('Se connecter');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Email ou mot de passe incorrect.',
  );
  expect(screen.getByLabelText('Email professionnel')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
});
it.each([
  {},
  { code: 'code', target: 'https://evil.example/api/auth/handoff' },
])('rejects malformed or unsafe handoff responses', async (payload) => {
  server.use(http.post('/api/auth/login', () => HttpResponse.json(payload)));
  render(<Identity config={config} path="/login" />);
  submit('Se connecter');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it('offers the recovery form on the public origin', async () => {
  server.use(
    http.post('/api/auth/forgot-password', async ({ request }) => {
      expect(await request.json()).toEqual({
        slug: 'acme',
        email: 'owner@example.com',
      });
      return HttpResponse.json({ sent: true });
    }),
  );
  render(<Identity config={config} path="/forgot-password" />);
  fireEvent.change(screen.getByLabelText('Espace d’entreprise'), {
    target: { value: 'acme' },
  });
  fireEvent.change(screen.getByLabelText('Email professionnel'), {
    target: { value: 'owner@example.com' },
  });
  submit('Envoyer le lien');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Si ce compte existe',
  );
  expect(
    screen.queryByRole('button', { name: 'Envoyer le lien' }),
  ).not.toBeInTheDocument();
});
it('uses tenant context for recovery and displays field errors', async () => {
  server.use(
    http.post('/api/auth/forgot-password', async ({ request }) => {
      expect(await request.json()).toMatchObject({ slug: 'acme' });
      return HttpResponse.json(
        { code: 'invalid_input', fields: { email: 'invalid' } },
        { status: 422 },
      );
    }),
  );
  render(
    <Identity config={{ ...config, tenant: 'acme' }} path="/forgot-password" />,
  );
  expect(
    screen.queryByLabelText('Espace d’entreprise'),
  ).not.toBeInTheDocument();
  submit('Envoyer le lien');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Vérifiez les champs',
  );
  expect(screen.getByLabelText('Email professionnel')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});
it('resets a password using the fragment token and removes it after success', async () => {
  history.replaceState(null, '', '/reset-password#token=secret');
  server.use(
    http.post('/api/auth/reset-password', async ({ request }) => {
      expect(await request.json()).toEqual({
        token: 'secret',
        password: 'new secure pass phrase',
      });
      return HttpResponse.json({ reset: true });
    }),
  );
  render(
    <Identity config={{ ...config, tenant: 'acme' }} path="/reset-password" />,
  );
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
    target: { value: 'new secure pass phrase' },
  });
  submit('Modifier le mot de passe');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Toutes vos sessions ont été fermées',
  );
  expect(window.location.hash).toBe('');
});
it('reports reset failures without losing the form', async () => {
  server.use(http.post('/api/auth/reset-password', () => HttpResponse.error()));
  render(
    <Identity config={{ ...config, tenant: 'acme' }} path="/reset-password" />,
  );
  submit('Modifier le mot de passe');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it('requires an explicit click to verify an email', async () => {
  history.replaceState(null, '', '/verify#token=verification');
  const verify = vi.fn();
  server.use(
    http.post('/api/registrations/verify', async ({ request }) => {
      verify(await request.json());
      return HttpResponse.json({ receipt: 'receipt' });
    }),
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: 'queued',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
  );
  render(<Identity config={config} path="/verify" />);
  expect(verify).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Création de votre espace' }),
  ).toBeInTheDocument();
  expect(verify).toHaveBeenCalledWith({ token: 'verification' });
  expect(location.hash).toBe('');
});
it('rejects expired verification links', async () => {
  history.replaceState(null, '', '/verify#token=old');
  server.use(
    http.post('/api/registrations/verify', () =>
      HttpResponse.json({ code: 'invalid_token' }, { status: 422 }),
    ),
  );
  render(<Identity config={config} path="/verify" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Ce lien est invalide ou a expiré',
  );
});
it('disables verification when the token is absent', () => {
  render(<Identity config={config} path="/verify" />);
  expect(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  ).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Ouvrez le lien reçu');
});
it('loads the protected home and sends its CSRF token on logout', async () => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(user)),
    http.post('/api/auth/logout', ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf-token');
      return HttpResponse.json({ logged_out: true });
    }),
  );
  render(<Identity config={{ ...config, tenant: 'acme' }} path="/" />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Chargement de votre session',
  );
  expect(
    await screen.findByRole('heading', { name: 'Bienvenue chez acme' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Bonjour Camille Durand.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(
    await screen.findByRole('heading', { name: 'Connexion — acme' }),
  ).toBeInTheDocument();
});
it('keeps the home visible on failed logout', async () => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(user)),
    http.post('/api/auth/logout', () => HttpResponse.error()),
  );
  render(<Identity config={{ ...config, tenant: 'acme' }} path="/" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Se déconnecter' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
  expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeEnabled();
});
it('shows login when there is no valid session', async () => {
  server.use(
    http.get('/api/auth/session', () =>
      HttpResponse.json({ code: 'unauthenticated' }, { status: 401 }),
    ),
  );
  render(<Identity config={{ ...config, tenant: 'acme' }} path="/" />);
  expect(
    await screen.findByRole('heading', { name: 'Connexion — acme' }),
  ).toBeInTheDocument();
});
it.each([{}, { ...user, first_name: 1 }])(
  'reports invalid session payloads',
  async (payload) => {
    server.use(http.get('/api/auth/session', () => HttpResponse.json(payload)));
    render(<Identity config={{ ...config, tenant: 'acme' }} path="/" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Le service est indisponible',
    );
  },
);
it('ignores stale session responses after unmount', async () => {
  server.use(
    http.get('/api/auth/session', async () => {
      await delay(30);
      return HttpResponse.json(user);
    }),
  );
  const view = render(
    <Identity config={{ ...config, tenant: 'acme' }} path="/" />,
  );
  view.unmount();
  await delay(50);
  expect(screen.queryByText('Bonjour Camille Durand.')).not.toBeInTheDocument();
});
it('routes unknown pages and tenant signups safely', () => {
  const view = render(<Identity config={config} path="/unknown" />);
  expect(screen.getByRole('heading')).toHaveTextContent('Page introuvable');
  view.rerender(
    <Identity config={{ ...config, tenant: 'acme' }} path="/signup" />,
  );
  expect(screen.getByRole('heading')).toHaveTextContent('Connexion — acme');
});
it('offers registration and public login', () => {
  const view = render(<Identity config={config} path="/signup" />);
  expect(
    screen.getByRole('heading', { name: 'Créer un compte' }),
  ).toBeInTheDocument();
  view.rerender(<Identity config={config} path="/" />);
  expect(
    screen.getByRole('heading', { name: 'Connexion' }),
  ).toBeInTheDocument();
});

it('starts login without errors and keeps the transfer code hidden and named', async () => {
  const post = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(() => undefined);
  server.use(
    http.post('/api/auth/login', async () => {
      await delay(60);
      return HttpResponse.json({
        code: 'secret',
        target: 'http://acme.ici.localhost:5173/api/auth/handoff',
      });
    }),
  );
  render(<Identity config={config} path="/login" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('.ici.localhost')).toBeInTheDocument();
  expect(screen.getByText('Pas encore de compte ?')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Espace d’entreprise'), {
    target: { value: 'acme' },
  });
  submit('Se connecter');
  expect(screen.getByRole('button', { name: 'Connexion…' })).toBeDisabled();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  const forms = document.querySelectorAll('form');
  const form = forms.item(forms.length - 1);
  expect(new FormData(form).get('code')).toBe('secret');
  expect(form.querySelector('input')).toHaveAttribute('type', 'hidden');
  form.remove();
});
it('clears old login errors and field markers while retrying', async () => {
  let count = 0;
  server.use(
    http.post('/api/auth/login', async () => {
      if (++count === 1)
        return HttpResponse.json(
          {
            code: 'invalid_input',
            fields: { slug: 'invalid', password: 'invalid' },
          },
          { status: 422 },
        );
      await delay(60);
      return HttpResponse.error();
    }),
  );
  render(<Identity config={config} path="/login" />);
  submit('Se connecter');
  await screen.findByRole('alert');
  expect(
    screen.getByLabelText('Espace d’entreprise'),
  ).toHaveAccessibleDescription('Vérifiez ce champ.');
  expect(screen.getByLabelText('Mot de passe')).toHaveAccessibleDescription(
    'Vérifiez ce champ.',
  );
  submit('Se connecter');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Mot de passe')).toHaveAttribute(
    'aria-invalid',
    'false',
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it.each([false, true])(
  'shows recovery labels and clears failed fields during retry: reset=%s',
  async (reset) => {
    history.replaceState(
      null,
      '',
      reset ? '/reset-password' : '/forgot-password',
    );
    let count = 0;
    server.use(
      http.post(
        reset ? '/api/auth/reset-password' : '/api/auth/forgot-password',
        async ({ request }) => {
          const body: unknown = await request.json();
          if (reset) expect(body).toMatchObject({ token: '' });
          if (++count === 1)
            return HttpResponse.json(
              {
                code: 'invalid_input',
                fields: { slug: 'invalid', password: 'invalid' },
              },
              { status: 422 },
            );
          await delay(60);
          return HttpResponse.error();
        },
      ),
    );
    render(
      <Identity
        config={config}
        path={reset ? '/reset-password' : '/forgot-password'}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent(
      reset ? 'Nouveau mot de passe' : 'Mot de passe oublié',
    );
    expect(
      screen.getByText(
        reset
          ? 'Choisissez un mot de passe de 15 à 128 caractères.'
          : 'Recevez un lien pour retrouver l’accès à votre espace.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const cta = reset ? 'Modifier le mot de passe' : 'Envoyer le lien';
    submit(cta);
    await screen.findByRole('alert');
    expect(
      screen.getByLabelText(
        reset ? 'Nouveau mot de passe' : 'Espace d’entreprise',
      ),
    ).toHaveAccessibleDescription('Vérifiez ce champ.');
    if (!reset) expect(screen.getByText('.ici.localhost')).toBeInTheDocument();
    submit(cta);
    expect(screen.getByRole('button', { name: 'Envoi…' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(
        reset ? 'Nouveau mot de passe' : 'Espace d’entreprise',
      ),
    ).toHaveAttribute('aria-invalid', 'false');
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: cta })).toBeEnabled();
  },
);
it('clears verification failures during a new attempt and re-enables the action', async () => {
  history.replaceState(null, '', '/verify#token=secret');
  server.use(
    http.post('/api/registrations/verify', async () => {
      await delay(60);
      return HttpResponse.error();
    }),
  );
  render(<Identity config={config} path="/verify" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  );
  expect(screen.getByRole('button', { name: 'Activation…' })).toBeDisabled();
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Activer mon entreprise' }),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByRole('alert');
});
it('shows the tenant user and administrator role and clears logout failures on retry', async () => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(user)),
    http.post('/api/auth/logout', async () => {
      await delay(60);
      return HttpResponse.error();
    }),
  );
  render(<Identity config={{ ...config, tenant: 'acme' }} path="/" />);
  expect(screen.getByRole('heading')).toHaveTextContent('Votre espace');
  await screen.findByRole('heading', { name: 'Bienvenue chez acme' });
  expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  expect(
    screen.getByText('Administrateur de l’entreprise acme.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(screen.getByRole('button', { name: 'Déconnexion…' })).toBeDisabled();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByRole('alert');
});
it('separates the registration link from its surrounding copy', () => {
  render(<Identity config={config} path="/login" />);
  expect(
    screen.getByRole('link', { name: 'Créer un compte' }).parentElement
      ?.textContent,
  ).toBe('Pas encore de compte ? Créer un compte');
});
it('keeps the current recovery URL when sending email', async () => {
  history.replaceState(null, '', '/forgot-password#help');
  server.use(
    http.post('/api/auth/forgot-password', () =>
      HttpResponse.json({ sent: true }),
    ),
  );
  render(<Identity config={config} path="/forgot-password" />);
  submit('Envoyer le lien');
  await screen.findByRole('status');
  expect(location.hash).toBe('#help');
});
