import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { fetchGreeting } from './api';

describe('greeting client', () => {
  it('returns the server message', async () => {
    expect(await fetchGreeting()).toBe('Hello World');
  });
  it('preserves a different server message', async () => {
    server.use(
      http.get('/api/hello', () => HttpResponse.json({ message: 'Welcome' })),
    );
    expect(await fetchGreeting()).toBe('Welcome');
  });
  it('rejects an unsuccessful HTTP status', async () => {
    server.use(
      http.get('/api/hello', () =>
        HttpResponse.json({ message: 'Hidden' }, { status: 503 }),
      ),
    );
    await expect(fetchGreeting()).rejects.toThrow('Unable to load greeting');
  });
  it('rejects network failures', async () => {
    server.use(http.get('/api/hello', () => HttpResponse.error()));
    await expect(fetchGreeting()).rejects.toThrow();
  });
  it.each([null, 42, 'Hello', [], {}, { message: 1 }, { message: null }])(
    'rejects invalid payload %j',
    async (body) => {
      server.use(http.get('/api/hello', () => HttpResponse.json(body)));
      await expect(fetchGreeting()).rejects.toThrow(
        'Invalid greeting response',
      );
    },
  );
  it('rejects invalid JSON', async () => {
    server.use(http.get('/api/hello', () => new HttpResponse('not json')));
    await expect(fetchGreeting()).rejects.toThrow();
  });
});
