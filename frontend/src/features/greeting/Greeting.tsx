import { useEffect, useState } from 'react';
import { fetchGreeting } from './api';

type GreetingState =
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error' };

export function Greeting() {
  const [state, setState] = useState<GreetingState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void fetchGreeting().then(
      (message) => {
        if (active) setState({ status: 'success', message });
      },
      () => {
        if (active) setState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') return <p role="status">Loading greeting…</p>;
  if (state.status === 'error')
    return <p role="alert">Unable to load greeting.</p>;
  return <h1>{state.message}</h1>;
}
