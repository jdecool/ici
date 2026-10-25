import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Field, formText } from './Field';
it('labels fields, suffixes and inline errors', () => {
  render(
    <Field
      label="Espace"
      name="slug"
      suffix=".ici.localhost"
      error="Indisponible"
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Espace' });
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Indisponible');
  expect(screen.getByText('.ici.localhost')).toBeInTheDocument();
});
it('toggles password visibility with an accessible control', () => {
  render(<Field label="Secret" name="password" type="password" />);
  const input = screen.getByLabelText('Secret');
  expect(input).toHaveAttribute('type', 'password');
  expect(input).toHaveAttribute('aria-invalid', 'false');
  fireEvent.click(
    screen.getByRole('button', { name: 'Afficher le mot de passe' }),
  );
  expect(input).toHaveAttribute('type', 'text');
  fireEvent.click(
    screen.getByRole('button', { name: 'Masquer le mot de passe' }),
  );
  expect(input).toHaveAttribute('type', 'password');
});
it('only accepts textual form fields', () => {
  const form = new FormData();
  form.set('name', 'Camille');
  form.set('file', new File(['text'], 'name'));
  expect(formText(form, 'name')).toBe('Camille');
  expect(formText(form, 'absent')).toBe('');
  expect(formText(form, 'file')).toBe('');
});

it('preserves email inputs and exposes no password controls on text fields', () => {
  render(<Field label="Email" name="email" type="email" />);
  expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('shows the password control text as well as its accessible label', () => {
  render(<Field label="Secret" name="password" type="password" />);
  const button = screen.getByRole('button', {
    name: 'Afficher le mot de passe',
  });
  expect(button).toHaveTextContent('Afficher');
  fireEvent.click(button);
  expect(
    screen.getByRole('button', { name: 'Masquer le mot de passe' }),
  ).toHaveTextContent('Masquer');
});
it('restores the requested input type when reusing a revealed password field', () => {
  const view = render(<Field label="Secret" name="value" type="password" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Afficher le mot de passe' }),
  );
  view.rerender(<Field label="Email" name="value" type="email" />);
  expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
});
