import { expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import {
  ApiError,
  configuration,
  errorMessage,
  object,
  request,
  string,
} from './api';

it('validates untrusted payloads', () => {
  for (const value of [null, [], 'text', 3])
    expect(() => object(value)).toThrow('invalid_response');
  expect(object({ a: 1 })).toEqual({ a: 1 });
  expect(string('hello')).toBe('hello');
  expect(() => string(1)).toThrow('invalid_response');
});
it('loads public configuration and a tenant configuration', async () => {
  expect((await configuration()).tenant).toBeNull();
  server.use(
    http.get('/api/config', () =>
      HttpResponse.json({
        root_domain: 'example.com',
        public_origin: 'https://example.com',
        tenant: 'acme',
        terms_version: 'v1',
      }),
    ),
  );
  expect(await configuration()).toEqual({
    rootDomain: 'example.com',
    publicOrigin: 'https://example.com',
    tenant: 'acme',
    termsVersion: 'v1',
  });
});
it('sends bodies and authentication headers and parses field errors', async () => {
  server.use(
    http.post('/api/test', async ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer receipt');
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(await request.json()).toEqual({ email: 'invalid' });
      return HttpResponse.json(
        { code: 'invalid_input', fields: { email: 'invalid' } },
        { status: 422 },
      );
    }),
  );
  await expect(
    request('/test', { email: 'invalid' }, { Authorization: 'Bearer receipt' }),
  ).rejects.toMatchObject({
    code: 'invalid_input',
    fields: { email: 'Vérifiez ce champ.' },
  });
});
it.each([undefined, null, 'invalid'])(
  'handles failures without valid field details: %s',
  async (fields) => {
    server.use(
      http.get('/api/test', () =>
        HttpResponse.json({ code: 'rate_limited', fields }, { status: 429 }),
      ),
    );
    await expect(request('/test')).rejects.toEqual(
      new ApiError('rate_limited'),
    );
  },
);
it.each([
  ['invalid_credentials', 'Email ou mot de passe incorrect.'],
  ['slug_unavailable', 'Cet espace est déjà réservé. Choisissez un autre nom.'],
  ['rate_limited', 'Trop de tentatives. Réessayez dans 15 minutes.'],
  [
    'invalid_token',
    'Ce lien est invalide ou a expiré. Demandez un nouvel email.',
  ],
  ['invalid_input', 'Vérifiez les champs indiqués.'],
  [
    'invalid_host',
    'Cet espace d’entreprise est introuvable ou n’est pas encore actif.',
  ],
  [
    'unknown_tenant',
    'Cet espace d’entreprise est introuvable ou n’est pas encore actif.',
  ],
  ['unknown', 'Le service est indisponible. Veuillez réessayer.'],
])('translates %s', (code, message) => {
  expect(errorMessage(new ApiError(code))).toBe(message);
});
it('handles network failures', () => {
  expect(errorMessage(new Error())).toBe(
    'Le service est indisponible. Veuillez réessayer.',
  );
});

it('handles non-Error rejection values safely', () => {
  for (const value of [null, undefined, 'network'])
    expect(errorMessage(value)).toBe(
      'Le service est indisponible. Veuillez réessayer.',
    );
});
it('identifies malformed external object data using a stable error', async () => {
  server.use(http.get('/api/test', () => HttpResponse.json(null)));
  await expect(request('/test')).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

it.each([
  ['unauthenticated', 'Votre session a expiré. Reconnectez-vous.'],
  ['forbidden', 'Vous n’avez pas les droits nécessaires.'],
  ['csrf_failed', 'Votre session a changé. Rechargez la page.'],
  [
    'last_administrator',
    'L’entreprise doit conserver au moins un administrateur actif.',
  ],
  ['email_unavailable', 'Cette adresse email est déjà utilisée ou réservée.'],
  ['already_exists', 'Une équipe porte déjà ce nom.'],
  [
    'resource_in_use',
    'Suppression impossible : cet élément est utilisé par des utilisateurs, des présences ou une semaine type.',
  ],
  ['not_found', 'Cet élément n’existe plus. Actualisez la liste.'],
])('explains organization error %s', (code, message) => {
  expect(errorMessage(new ApiError(code))).toBe(message);
});
