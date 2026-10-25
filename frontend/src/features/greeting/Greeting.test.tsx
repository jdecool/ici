import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Greeting } from './Greeting';
import { fetchGreeting } from './api';

vi.mock('./api', () => ({ fetchGreeting: vi.fn() }));

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it('ignores an obsolete success after effect cleanup', async () => {
  const old = deferred();
  vi.mocked(fetchGreeting)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce('Current');
  render(
    <StrictMode>
      <Greeting />
    </StrictMode>,
  );
  expect(await screen.findByRole('heading')).toHaveTextContent('Current');
  await act(async () => {
    old.resolve('Stale');
    await old.promise;
  });
  expect(screen.getByRole('heading')).toHaveTextContent('Current');
});

it('ignores an obsolete failure after effect cleanup', async () => {
  const old = deferred();
  vi.mocked(fetchGreeting)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce('Current');
  render(
    <StrictMode>
      <Greeting />
    </StrictMode>,
  );
  expect(await screen.findByRole('heading')).toHaveTextContent('Current');
  await act(async () => {
    old.reject(new Error('Stale'));
    await old.promise.catch(() => undefined);
  });
  expect(screen.getByRole('heading')).toHaveTextContent('Current');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
