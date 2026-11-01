import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { responseGate } from '../../test/responseGate';
import { server } from '../../test/server';
import { Identity } from './Identity';
const config = {
  rootDomain: 'ici.localhost',
  publicOrigin: 'http://ici.localhost:5173',
  tenant: 'acme',
  termsVersion: '2026-10-draft',
};
const current = {
  id: 'owner-id',
  company: 'acme',
  email: 'owner@example.com',
  first_name: 'Camille',
  last_name: 'Durand',
  role: 'admin',
  csrf: 'csrf',
};
it.each([false, true])(
  'ignores obsolete sessions under StrictMode: error=%s',
  async (fail) => {
    let count = 0;
    const response = responseGate();
    server.use(
      http.get('/api/auth/session', async () => {
        if (++count === 1) {
          await response.pending;
          return fail
            ? HttpResponse.error()
            : HttpResponse.json({ ...current, company: 'obsolete' });
        }
        return HttpResponse.json(current);
      }),
    );
    render(
      <StrictMode>
        <Identity config={config} path="/" />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Bienvenue chez acme' });
    await response.release();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Bienvenue chez acme',
    );
  },
);
