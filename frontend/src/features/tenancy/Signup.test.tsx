import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { Availability, RegistrationStatus, Signup } from './Signup';
const config = {
  rootDomain: 'ici.localhost',
  publicOrigin: 'http://ici.localhost:5173',
  tenant: null,
  termsVersion: '2026-10-draft',
};
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());
function submit() {
  const form = screen
    .getByRole('button', { name: 'Créer mon espace' })
    .closest('form');
  if (!form) throw new Error('missing form');
  expect(fireEvent.submit(form)).toBe(false);
}
it('debounces availability checks by 300ms', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const queried = vi.fn();
  server.use(
    http.get('/api/tenants/availability', ({ request }) => {
      queried(new URL(request.url).searchParams.get('slug'));
      return HttpResponse.json({ available: true });
    }),
  );
  const view = render(<Availability slug="acme" />);
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(queried).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  vi.useRealTimers();
  expect(await screen.findByRole('status')).toHaveTextContent(
    /Vérification|disponible/,
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cet espace est disponible.',
    ),
  );
  expect(queried).toHaveBeenCalledWith('acme');
  view.rerender(<Availability slug="" />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
});
it('ignores obsolete availability responses', async () => {
  server.use(
    http.get('/api/tenants/availability', async ({ request }) => {
      const slug = new URL(request.url).searchParams.get('slug');
      await delay(slug === 'slow' ? 450 : 1);
      return HttpResponse.json({ available: slug !== 'slow' });
    }),
  );
  const view = render(<Availability slug="slow" />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Vérification…'),
  );
  view.rerender(<Availability slug="fast" />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cet espace est disponible.',
    ),
  );
  await delay(500);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cet espace est disponible.',
  );
});
it.each([false, 'invalid'])(
  'announces unavailable or invalid responses: %s',
  async (available) => {
    server.use(
      http.get('/api/tenants/availability', () =>
        HttpResponse.json({ available }),
      ),
    );
    render(<Availability slug="acme" />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        available === false
          ? 'Cet espace est indisponible.'
          : 'Impossible de vérifier cet espace.',
      ),
    );
  },
);
it('announces availability network errors', async () => {
  server.use(http.get('/api/tenants/availability', () => HttpResponse.error()));
  render(<Availability slug="acme" />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Impossible de vérifier cet espace.',
    ),
  );
});
it('posts registration with the accepted legal version and shows email confirmation', async () => {
  server.use(
    http.get('/api/tenants/availability', () =>
      HttpResponse.json({ available: true }),
    ),
    http.post('/api/registrations', async ({ request }) => {
      expect(await request.json()).toEqual({
        first_name: 'Camille',
        last_name: 'Durand',
        slug: 'acme',
        email: 'owner@example.com',
        password: 'a secure pass phrase',
        accepted_terms: true,
        terms_version: '2026-10-draft',
      });
      await delay(30);
      return HttpResponse.json({ receipt: 'receipt' });
    }),
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: 'pending',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
  );
  render(<Signup config={config} />);
  for (const [label, value] of [
    ['Prénom', 'Camille'],
    ['Nom', 'Durand'],
    ['Espace d’entreprise', 'ACME'],
    ['Email professionnel', 'owner@example.com'],
    ['Mot de passe', 'a secure pass phrase'],
  ]) {
    if (label && value)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('.ici.localhost')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'conditions d’utilisation' }),
  ).toHaveAttribute('href', '/terms');
  submit();
  expect(screen.getByRole('button', { name: 'Création…' })).toBeDisabled();
  expect(
    await screen.findByRole('heading', { name: 'Vérifiez votre email' }),
  ).toBeInTheDocument();
  expect(sessionStorage.getItem('registration-receipt')).toBe('receipt');
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle inscription' }));
  expect(
    screen.getByRole('heading', { name: 'Créer un compte' }),
  ).toBeInTheDocument();
  expect(sessionStorage.getItem('registration-receipt')).toBeNull();
});
it('displays field errors from registration conflicts', async () => {
  server.use(
    http.post('/api/registrations', () =>
      HttpResponse.json(
        {
          code: 'invalid_input',
          fields: {
            first_name: 'invalid',
            last_name: 'invalid',
            slug: 'invalid',
            email: 'invalid',
            password: 'invalid',
            accepted_terms: 'invalid',
          },
        },
        { status: 422 },
      ),
    ),
  );
  render(<Signup config={config} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Vérifiez les champs indiqués.',
  );
  expect(screen.getByLabelText('Prénom')).toHaveAccessibleDescription(
    'Vérifiez ce champ.',
  );
  expect(
    screen.getByRole('button', { name: 'Créer mon espace' }),
  ).toBeEnabled();
});
it('reports registration network failures', async () => {
  server.use(http.post('/api/registrations', () => HttpResponse.error()));
  render(<Signup config={config} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it('resumes email confirmation after a reload and resends verification', async () => {
  sessionStorage.setItem('registration-receipt', 'receipt');
  server.use(
    http.get('/api/registrations/status', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer receipt');
      return HttpResponse.json({
        state: 'pending',
        origin: 'http://acme.ici.localhost:5173',
      });
    }),
    http.post('/api/registrations/resend', async ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer receipt');
      await delay(20);
      return HttpResponse.json({ sent: true });
    }),
  );
  render(<Signup config={config} />);
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  expect(screen.getByRole('button', { name: 'Envoi…' })).toBeDisabled();
  expect(
    await screen.findByText('Un nouvel email de vérification a été envoyé.'),
  ).toBeInTheDocument();
});
it('reports resend errors', async () => {
  server.use(
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: 'pending',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
    http.post('/api/registrations/resend', () => HttpResponse.error()),
  );
  render(<RegistrationStatus receipt="receipt" />);
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it.each(['active', 'expired', 'failed', 'provisioning'])(
  'shows registration state %s',
  async (state) => {
    server.use(
      http.get('/api/registrations/status', () =>
        HttpResponse.json({ state, origin: 'http://acme.ici.localhost:5173' }),
      ),
    );
    render(<RegistrationStatus receipt="receipt" />);
    await waitFor(() =>
      expect(screen.getByRole('heading')).toHaveTextContent(
        state === 'active'
          ? 'Votre espace est prêt'
          : state === 'expired'
            ? 'Réservation expirée'
            : 'Création de votre espace',
      ),
    );
    if (state === 'active')
      expect(
        screen.getByRole('link', { name: 'Accéder à mon espace' }),
      ).toHaveAttribute('href', 'http://acme.ici.localhost:5173/login');
  },
);
it('polls until provisioning is complete', async () => {
  let count = 0;
  server.use(
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: ++count === 1 ? 'queued' : 'active',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
  );
  render(<RegistrationStatus receipt="receipt" />);
  expect(
    await screen.findByRole(
      'heading',
      { name: 'Votre espace est prêt' },
      { timeout: 3000 },
    ),
  ).toBeInTheDocument();
  expect(count).toBe(2);
});
it('announces failed polling requests', async () => {
  server.use(http.get('/api/registrations/status', () => HttpResponse.error()));
  render(<RegistrationStatus receipt="receipt" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible',
  );
});
it('ignores status responses after unmount', async () => {
  server.use(
    http.get('/api/registrations/status', async () => {
      await delay(30);
      return HttpResponse.json({
        state: 'active',
        origin: 'http://acme.ici.localhost:5173',
      });
    }),
  );
  const view = render(<RegistrationStatus receipt="receipt" />);
  view.unmount();
  await delay(50);
  expect(
    screen.queryByRole('link', { name: 'Accéder à mon espace' }),
  ).not.toBeInTheDocument();
});

it('starts with empty inputs, no error, and a legal consent description', () => {
  render(<Signup config={config} />);
  expect(screen.getByLabelText('Espace d’entreprise')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.getByRole('checkbox')).toHaveAccessibleName(
    'J’accepte les conditions d’utilisation et la politique de confidentialité provisoires.',
  );
  expect(document.getElementById('terms-error')).not.toBeInTheDocument();
});
it('associates every server field error with its input, including consent', async () => {
  server.use(
    http.post('/api/registrations', () =>
      HttpResponse.json(
        {
          code: 'invalid_input',
          fields: {
            first_name: 'invalid',
            last_name: 'invalid',
            slug: 'invalid',
            email: 'invalid',
            password: 'invalid',
            accepted_terms: 'invalid',
          },
        },
        { status: 422 },
      ),
    ),
  );
  render(<Signup config={config} />);
  submit();
  await screen.findByRole('alert');
  for (const label of [
    'Prénom',
    'Nom',
    'Espace d’entreprise',
    'Email professionnel',
    'Mot de passe',
  ])
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
      'Vérifiez ce champ.',
    );
  expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
    'Vérifiez ce champ.',
  );
});
it('clears field errors and the old alert while retrying registration', async () => {
  let count = 0;
  server.use(
    http.post('/api/registrations', async () => {
      if (++count === 1)
        return HttpResponse.json(
          { code: 'invalid_input', fields: { email: 'invalid' } },
          { status: 422 },
        );
      await delay(100);
      return HttpResponse.json(
        { code: 'slug_unavailable', fields: { slug: 'unavailable' } },
        { status: 409 },
      );
    }),
  );
  render(<Signup config={config} />);
  submit();
  await screen.findByRole('alert');
  submit();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Email professionnel')).toHaveAttribute(
    'aria-invalid',
    'false',
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Cet espace est déjà réservé.',
  );
  expect(
    screen.getByLabelText('Espace d’entreprise'),
  ).toHaveAccessibleDescription('Vérifiez ce champ.');
});
it('cancels a debounce before it issues an obsolete request', async () => {
  const calls: string[] = [];
  server.use(
    http.get('/api/tenants/availability', ({ request }) => {
      calls.push(new URL(request.url).searchParams.get('slug') ?? '');
      return HttpResponse.json({ available: true });
    }),
  );
  const view = render(<Availability slug="old" />);
  view.rerender(<Availability slug="new" />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cet espace est disponible.',
    ),
  );
  expect(calls).toEqual(['new']);
});
it('ignores an obsolete availability error', async () => {
  const started = vi.fn();
  server.use(
    http.get('/api/tenants/availability', async ({ request }) => {
      const slug = new URL(request.url).searchParams.get('slug');
      started(slug);
      if (slug === 'old') {
        await delay(600);
        return HttpResponse.error();
      }
      return HttpResponse.json({ available: true });
    }),
  );
  const view = render(<Availability slug="old" />);
  await waitFor(() => expect(started).toHaveBeenCalledWith('old'));
  view.rerender(<Availability slug="new" />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cet espace est disponible.',
    ),
  );
  await act(() => delay(650));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cet espace est disponible.',
  );
});
it.each([
  [
    'pending',
    'Un email vous a été envoyé. Ouvrez le lien et confirmez l’activation de votre entreprise.',
  ],
  ['active', 'Vous pouvez maintenant vous connecter.'],
  ['expired', 'Créez une nouvelle inscription pour réserver votre espace.'],
  [
    'queued',
    'Votre adresse est confirmée. Nous préparons votre entreprise, cette page se met à jour automatiquement.',
  ],
])(
  'explains the %s state and offers only relevant actions',
  async (state, description) => {
    server.use(
      http.get('/api/registrations/status', () =>
        HttpResponse.json({ state, origin: 'http://acme.ici.localhost:5173' }),
      ),
    );
    render(<RegistrationStatus receipt="receipt" />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(description ?? ''),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(1);
    expect(
      screen.queryAllByRole('button', { name: 'Renvoyer l’email' }),
    ).toHaveLength(state === 'pending' ? 1 : 0);
    expect(
      screen.queryAllByRole('link', { name: 'Accéder à mon espace' }),
    ).toHaveLength(state === 'active' ? 1 : 0);
  },
);
it.each(['active', 'expired'])('stops polling after %s', async (state) => {
  let count = 0;
  server.use(
    http.get('/api/registrations/status', () => {
      count++;
      return HttpResponse.json({
        state,
        origin: 'http://acme.ici.localhost:5173',
      });
    }),
  );
  render(<RegistrationStatus receipt="receipt" />);
  await waitFor(() => expect(count).toBe(1));
  await act(() => delay(2200));
  expect(count).toBe(1);
});
it('retries a transient status error and clears its alert', async () => {
  let count = 0;
  server.use(
    http.get('/api/registrations/status', () =>
      ++count === 1
        ? HttpResponse.error()
        : HttpResponse.json({
            state: 'active',
            origin: 'http://acme.ici.localhost:5173',
          }),
    ),
  );
  render(<RegistrationStatus receipt="receipt" />);
  await screen.findByRole('alert');
  expect(
    await screen.findByRole(
      'heading',
      { name: 'Votre espace est prêt' },
      { timeout: 3000 },
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('ignores outdated receipt results and errors after a receipt changes', async () => {
  const seen = vi.fn();
  server.use(
    http.get('/api/registrations/status', async ({ request }) => {
      const auth = request.headers.get('authorization');
      seen(auth);
      if (auth === 'Bearer old') {
        await delay(200);
        return HttpResponse.error();
      }
      return HttpResponse.json({
        state: 'active',
        origin: 'http://bravo.ici.localhost:5173',
      });
    }),
  );
  const view = render(<RegistrationStatus receipt="old" />);
  await waitFor(() => expect(seen).toHaveBeenCalledWith('Bearer old'));
  view.rerender(<RegistrationStatus receipt="new" />);
  await screen.findByRole('heading', { name: 'Votre espace est prêt' });
  await act(() => delay(250));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Accéder à mon espace' }),
  ).toHaveAttribute('href', 'http://bravo.ici.localhost:5173/login');
});
it('clears resend messages on retry and re-enables its control', async () => {
  let count = 0;
  server.use(
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: 'pending',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
    http.post('/api/registrations/resend', async () => {
      await delay(50);
      return ++count === 1
        ? HttpResponse.json({ sent: true })
        : HttpResponse.error();
    }),
  );
  render(<RegistrationStatus receipt="receipt" />);
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  const message = await screen.findByText(
    'Un nouvel email de vérification a été envoyé.',
  );
  expect(message).toHaveAttribute('role', 'status');
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  expect(
    screen.queryByText('Un nouvel email de vérification a été envoyé.'),
  ).not.toBeInTheDocument();
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Renvoyer l’email' }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByRole('alert');
});
it('separates the legal links in the consent copy', () => {
  render(<Signup config={config} />);
  expect(screen.getByRole('checkbox').parentElement?.textContent).toBe(
    'J’accepte les conditions d’utilisation et la politique de confidentialité provisoires.',
  );
});
it('shows no stale status error while the first status request is pending', async () => {
  server.use(
    http.get('/api/registrations/status', async () => {
      await delay(50);
      return HttpResponse.json({
        state: 'active',
        origin: 'http://acme.ici.localhost:5173',
      });
    }),
  );
  render(<RegistrationStatus receipt="receipt" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await screen.findByRole('heading', { name: 'Votre espace est prêt' });
});
it('ignores obsolete successful status responses after receipt rotation', async () => {
  const seen = vi.fn();
  server.use(
    http.get('/api/registrations/status', async ({ request }) => {
      const old = request.headers.get('authorization') === 'Bearer old';
      seen(old);
      if (old) await delay(150);
      return HttpResponse.json({
        state: old ? 'pending' : 'active',
        origin: 'http://acme.ici.localhost:5173',
      });
    }),
  );
  const view = render(<RegistrationStatus receipt="old" />);
  await waitFor(() => expect(seen).toHaveBeenCalledWith(true));
  view.rerender(<RegistrationStatus receipt="new" />);
  await screen.findByRole('heading', { name: 'Votre espace est prêt' });
  await act(() => delay(200));
  expect(screen.getByRole('heading')).toHaveTextContent(
    'Votre espace est prêt',
  );
});
it('announces only the pending confirmation while resending email', async () => {
  server.use(
    http.get('/api/registrations/status', () =>
      HttpResponse.json({
        state: 'pending',
        origin: 'http://acme.ici.localhost:5173',
      }),
    ),
    http.post('/api/registrations/resend', async () => {
      await delay(60);
      return HttpResponse.json({ sent: true });
    }),
  );
  render(<RegistrationStatus receipt="receipt" />);
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer l’email' }));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await screen.findByText('Un nouvel email de vérification a été envoyé.');
});
it('enforces the workspace syntax through native form constraints', () => {
  render(<Signup config={config} />);
  const input = screen.getByRole<HTMLInputElement>('textbox', {
    name: 'Espace d’entreprise',
  });
  expect(() => new RegExp(input.pattern, 'v')).not.toThrow();
  for (const name of ['acme', 'acme-42']) {
    fireEvent.change(input, { target: { value: name } });
    expect(input.checkValidity()).toBe(true);
  }
  for (const name of ['-acme', 'acme-', 'acme_team', 'acme.team']) {
    fireEvent.change(input, { target: { value: name } });
    expect(input.checkValidity()).toBe(false);
  }
});
