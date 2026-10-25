import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { server } from '../test/server';
import { App } from './App';

it('renders the greeting inside the main landmark', async () => {
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading greeting…');
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Hello World',
  );
  expect(screen.getByRole('main')).toContainElement(
    screen.getByRole('heading'),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('renders a server-provided message', async () => {
  server.use(
    http.get('/api/hello', () => HttpResponse.json({ message: 'Welcome' })),
  );
  render(<App />);
  expect(await screen.findByRole('heading')).toHaveTextContent('Welcome');
});

it('announces HTTP failure accessibly', async () => {
  server.use(
    http.get('/api/hello', () => new HttpResponse(null, { status: 500 })),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load greeting.',
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});

it('announces malformed responses', async () => {
  server.use(
    http.get('/api/hello', () => HttpResponse.json({ unexpected: true })),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load greeting.',
  );
});

it('announces network failure', async () => {
  server.use(http.get('/api/hello', () => HttpResponse.error()));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load greeting.',
  );
});
