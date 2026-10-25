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

it('announces loading until the greeting arrives', async () => {
  const pending = deferred();
  vi.mocked(fetchGreeting).mockReturnValueOnce(pending.promise);
  render(<Greeting />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading greeting…');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => {
    pending.resolve('Hello World');
    await pending.promise;
  });
  expect(screen.getByRole('heading')).toHaveTextContent('Hello World');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('announces greeting failures', async () => {
  vi.mocked(fetchGreeting).mockRejectedValueOnce(new Error('network'));
  render(<Greeting />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load greeting.',
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
