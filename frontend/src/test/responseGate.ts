import { act } from '@testing-library/react';
import { delay } from 'msw';

// Release a held response, then let fetch and React consume it before asserting.
export function responseGate() {
  let resolve = () => {};
  const pending = new Promise<void>((release) => {
    resolve = release;
  });
  return {
    pending,
    async release() {
      await act(async () => {
        resolve();
        await delay(0);
      });
    },
  };
}
