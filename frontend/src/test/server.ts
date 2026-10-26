import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const server = setupServer(
  http.get('/api/config', () =>
    HttpResponse.json({
      root_domain: 'ici.localhost',
      public_origin: 'http://ici.localhost:5173',
      tenant: null,
      terms_version: '2026-10-draft',
    }),
  ),
);
