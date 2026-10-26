import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { server } from '../../test/server';
import { Identity } from './Identity';
const config = {
  rootDomain: 'ici.localhost',
  publicOrigin: 'http://ici.localhost:5173',
  tenant: 'acme',
  termsVersion: '2026-10-draft',
};
afterEach(() => history.replaceState(null, '', '/'));
function submit(name: string) {
  const form = screen.getByRole('button', { name }).closest('form');
  if (!form) throw new Error('form');
  expect(fireEvent.submit(form)).toBe(false);
}
it('accepts an invitation with password and versioned consent', async () => {
  history.replaceState(null, '', '/accept-invitation#token=invite');
  server.use(
    http.post('/api/auth/accept-invitation', async ({ request }) => {
      expect(await request.json()).toEqual({
        token: 'invite',
        password: 'A secure pass phrase1!',
        accepted_terms: true,
        terms_version: '2026-10-draft',
      });
      return HttpResponse.json({ activated: true });
    }),
  );
  render(<Identity config={config} path="/accept-invitation" />);
  fireEvent.change(screen.getByLabelText('Mot de passe'), {
    target: { value: 'A secure pass phrase1!' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  submit('Activer mon compte');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Votre compte est activé',
  );
  expect(location.hash).toBe('');
  expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
    'href',
    '/login',
  );
});
it('requires a link and handles invalid tokens and field errors', async () => {
  const view = render(<Identity config={config} path="/accept-invitation" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Ouvrez le lien');
  view.unmount();
  history.replaceState(null, '', '/accept-invitation#token=bad');
  server.use(
    http.post('/api/auth/accept-invitation', () =>
      HttpResponse.json(
        {
          code: 'invalid_input',
          fields: { password: 'invalid', accepted_terms: 'invalid' },
        },
        { status: 422 },
      ),
    ),
  );
  render(<Identity config={config} path="/accept-invitation" />);
  submit('Activer mon compte');
  expect(await screen.findByRole('alert')).toHaveTextContent('Vérifiez');
  expect(screen.getByLabelText('Mot de passe')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});
it('confirms a new address explicitly and supports retry', async () => {
  history.replaceState(null, '', '/confirm-email#token=confirmation');
  server.use(
    http.post('/api/auth/confirm-email', () =>
      HttpResponse.json({ code: 'invalid_token' }, { status: 422 }),
    ),
  );
  render(<Identity config={config} path="/confirm-email" />);
  expect(screen.queryByLabelText('Mot de passe')).not.toBeInTheDocument();
  submit('Confirmer mon adresse');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'invalide ou a expiré',
  );
  server.use(
    http.post('/api/auth/confirm-email', async ({ request }) => {
      expect(await request.json()).toEqual({ token: 'confirmation' });
      return HttpResponse.json({ confirmed: true });
    }),
  );
  submit('Confirmer mon adresse');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Reconnectez-vous avec votre nouvelle adresse',
  );
});
it('keeps tenant-only activation pages off the public origin', () => {
  render(
    <Identity config={{ ...config, tenant: null }} path="/accept-invitation" />,
  );
  expect(screen.getByRole('heading')).toHaveTextContent('Connexion');
});

it('announces submission, clears validation on retry, and survives transport errors', async () => {
  history.replaceState(null, '', '/accept-invitation#token=invite');
  server.use(
    http.post('/api/auth/accept-invitation', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return HttpResponse.json(
        {
          code: 'invalid_input',
          fields: { password: 'invalid', accepted_terms: 'invalid' },
        },
        { status: 422 },
      );
    }),
  );
  render(<Identity config={config} path="/accept-invitation" />);
  expect(
    screen.getByRole('heading', { name: 'Rejoindre mon entreprise' }),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toHaveAccessibleName(
    'J’accepte les conditions d’utilisation .',
  );
  expect(screen.getByRole('checkbox').closest('label')?.textContent).toBe(
    'J’accepte les conditions d’utilisation.',
  );
  for (const paragraph of document.querySelectorAll('p'))
    expect(paragraph.textContent?.trim()).not.toBe('');
  submit('Activer mon compte');
  expect(
    await screen.findByRole('button', { name: 'Confirmation…' }),
  ).toBeDisabled();
  await screen.findByRole('alert');
  expect(screen.getAllByText('Vérifiez ce champ.')).toHaveLength(2);
  server.use(
    http.post('/api/auth/accept-invitation', () => HttpResponse.error()),
  );
  submit('Activer mon compte');
  expect(screen.queryByText('Vérifiez ce champ.')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Le service est indisponible. Veuillez réessayer.',
  );
});
it('names the email confirmation screen', () => {
  history.replaceState(null, '', '/confirm-email#token=token');
  render(<Identity config={config} path="/confirm-email" />);
  expect(
    screen.getByRole('heading', { name: 'Confirmer mon adresse email' }),
  ).toBeVisible();
});
