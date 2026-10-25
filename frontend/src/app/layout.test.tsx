import { render, screen } from '@testing-library/react';
import { expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
const styles = readFileSync('src/app/style.css', 'utf8');
import { App } from './App';
import { Field } from '../shared/Field';
afterEach(() => history.replaceState(null, '', '/'));
it.each([
  ['/', '1160px'],
  ['/terms', '800px'],
])('uses the intended content width at %s', (path, width) => {
  history.replaceState(null, '', path);
  render(
    <>
      <style>{styles}</style>
      <App />
    </>,
  );
  expect(getComputedStyle(screen.getByRole('main')).maxWidth).toBe(width);
});
it('renders a suffix inside a fixed-height adjoining box', () => {
  render(
    <>
      <style>{styles}</style>
      <Field label="Espace" name="slug" suffix=".ici.localhost" />
    </>,
  );
  expect(getComputedStyle(screen.getByText('.ici.localhost')).height).toBe(
    '44px',
  );
});
it('styles the planning cells as 28px presence blocks', () => {
  render(
    <>
      <style>{styles}</style>
      <App />
    </>,
  );
  expect(
    getComputedStyle(
      screen.getAllByRole('cell')[0] ?? screen.getByRole('table'),
    ).height,
  ).toBe('28px');
});
it('distinguishes an unfilled day with a dashed border', () => {
  render(
    <>
      <style>{styles}</style>
      <App />
    </>,
  );
  expect(
    getComputedStyle(screen.getByRole('cell', { name: 'Non renseigné' }))
      .borderStyle,
  ).toBe('dashed');
});
