import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { responseGate } from '../test/responseGate';
import { server } from '../test/server';
import { App } from './App';
const current = {
  root_domain: 'ici.localhost',
  public_origin: 'http://ici.localhost:5173',
  tenant: null,
  terms_version: '2026-10-draft',
};
it.each([false, true])(
  'ignores obsolete configuration responses under StrictMode: error=%s',
  async (fail) => {
    let count = 0;
    const response = responseGate();
    server.use(
      http.get('/api/config', async () => {
        if (++count === 1) {
          await response.pending;
          return fail
            ? HttpResponse.error()
            : HttpResponse.json({
                ...current,
                root_domain: 'obsolete.example',
              });
        }
        return HttpResponse.json(current);
      }),
    );
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Connexion' });
    await response.release();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('.ici.localhost')).toBeInTheDocument();
    expect(screen.queryByText('.obsolete.example')).not.toBeInTheDocument();
  },
);
