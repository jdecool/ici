import { useEffect, useState } from 'react';
import { fetchGreeting } from './api';

type GreetingState =
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error' };

export function Greeting() {
  const [state, setState] = useState<GreetingState>({ status: 'loading' });

  useEffect(
    () => {
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
    },
    // Stryker disable next-line ArrayDeclaration: A constant sentinel and an empty dependency list both stay stable across renders.
    [],
  );

  switch (state.status) {
    case 'loading':
      return <p role="status">Loading greeting…</p>;
    case 'error':
      return <p role="alert">Unable to load greeting.</p>;
    case 'success':
      return <h1>{state.message}</h1>;
  }
}
