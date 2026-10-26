import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
afterEach(() => vi.restoreAllMocks());
it('opens a named modal, cancels explicitly, closes and returns focus', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const close = vi.fn();
  const opened = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
  const closed = vi.spyOn(HTMLDialogElement.prototype, 'close');
  const view = render(
    <Dialog title="Confirmation" busy={false} close={close} alert>
      <p>Confirm the action</p>
    </Dialog>,
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Confirmation' });
  expect(opened).toHaveBeenCalledOnce();
  expect(dialog).toHaveAttribute('open');
  expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(
    false,
  );
  expect(close).toHaveBeenCalledOnce();
  view.rerender(
    <Dialog title="Confirmation" busy close={close} alert>
      <button>Working</button>
    </Dialog>,
  );
  expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(
    false,
  );
  expect(close).toHaveBeenCalledOnce();
  screen.getByRole('button', { name: 'Working' }).focus();
  expect(screen.getByRole('button', { name: 'Working' })).toHaveFocus();
  view.unmount();
  expect(closed).toHaveBeenCalledOnce();
  expect(opener).toHaveFocus();
  opener.remove();
});
it('handles documents without a previously focused HTML element', () => {
  vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
  const view = render(
    <Dialog title="Edit" busy={false} close={() => undefined}>
      <p>Details</p>
    </Dialog>,
  );
  expect(screen.getByRole('dialog', { name: 'Edit' })).toBeVisible();
  view.unmount();
});
