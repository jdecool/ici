import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Dialog({
  title,
  children,
  busy,
  close,
  alert = false,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  close: () => void;
  alert?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(
    () => {
      const element = dialog.current;
      const previous = document.activeElement;
      // Stryker disable next-line OptionalChaining: The mounted dialog ref is non-null; removing the defensive optional access is equivalent.
      element?.showModal();
      return () => {
        // Stryker disable next-line OptionalChaining: The captured mounted element remains available during cleanup.
        element?.close();
        if (previous instanceof HTMLElement) previous.focus();
      };
    },
    // Stryker disable next-line ArrayDeclaration: An empty list and a constant sentinel both preserve the mount-only effect lifetime.
    [],
  );
  return (
    <dialog
      ref={dialog}
      role={alert ? 'alertdialog' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="dialog-title"
      className="workspace-dialog"
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
