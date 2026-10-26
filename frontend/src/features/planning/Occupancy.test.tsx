import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Occupancy } from './Occupancy';
import type { Entry, Week } from './model';
it.each([false, true])(
  'normalizes both histogram halves across all locations (reversed: %s)',
  (reverse) => {
    const entries: Entry[] = [
      ...['a', 'b', 'c'].map((user_id) => ({
        user_id,
        date: '2026-10-26',
        half: 'am' as const,
        status: 'office' as const,
        location_id: 'paris',
        note: '',
      })),
      {
        user_id: 'a',
        date: '2026-10-26',
        half: 'pm',
        status: 'office',
        location_id: 'paris',
        note: '',
      },
      ...['a', 'b', 'c', 'd'].map((user_id) => ({
        user_id,
        date: '2026-10-27',
        half: 'pm' as const,
        status: 'office' as const,
        location_id: 'lyon',
        note: '',
      })),
    ];
    if (reverse)
      for (const item of entries) item.half = item.half === 'am' ? 'pm' : 'am';
    const week: Week = {
      start: '2026-10-26',
      work_days: [0, 1],
      teams: [],
      users: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        first_name: id.toUpperCase(),
        last_name: 'Martin',
        team_id: null,
        location_id: null,
      })),
      locations: [
        { id: 'paris', name: 'Paris', code: 'PAR', city: 'Paris' },
        { id: 'lyon', name: 'Lyon', code: 'LYO', city: 'Lyon' },
      ],
      entries,
    };
    const renderLocation = (id: string) => <h3>{id}</h3>;
    const view = render(
      <Occupancy week={week} day={0} renderLocation={renderLocation} />,
    );
    const paris = screen.getByRole('article', { name: 'Occupation Paris' });
    expect(
      within(paris).getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            (reverse
              ? '1 le matin · 3 l’après-midi'
              : '3 le matin · 1 l’après-midi'),
      ),
    ).toBeVisible();
    expect(
      within(paris).getByRole('heading', { name: 'Présents le 26/10/2026' }),
    ).toBeVisible();
    expect(
      within(paris)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['A Martin', 'B Martin', 'C Martin']);
    const high = within(paris).getByTitle(
      reverse ? 'Après-midi : 3' : 'Matin : 3',
    );
    const low = within(paris).getByTitle(
      reverse ? 'Matin : 1' : 'Après-midi : 1',
    );
    expect(high).toHaveStyle({ height: '54px' });
    expect(low).toHaveStyle({ height: '18px' });
    const selected = high.parentElement?.parentElement;
    expect(selected).toHaveClass('selected-day');
    expect(within(paris).getByText('Lun', { exact: true })).toBeVisible();
    expect(within(paris).getByText('Mar', { exact: true })).toBeVisible();
    expect(
      within(paris).getByText(
        reverse ? ': 1 matin, 3 après-midi' : ': 3 matin, 1 après-midi',
      ),
    ).toBeInTheDocument();
    expect(within(paris).getByTitle('Matin : 0')).toHaveStyle({
      height: '2px',
    });
    expect(within(paris).getByTitle('Après-midi : 0')).toHaveStyle({
      height: '2px',
    });
    const lyon = screen.getByRole('article', { name: 'Occupation Lyon' });
    expect(
      within(lyon).getByTitle(reverse ? 'Matin : 4' : 'Après-midi : 4'),
    ).toHaveStyle({ height: '72px' });
    view.rerender(
      <Occupancy week={week} day={1} renderLocation={renderLocation} />,
    );
    expect(selected).not.toHaveClass('selected-day');
    expect(
      within(paris).getByText('Aucune présence renseignée.'),
    ).toBeVisible();
    expect(within(lyon).getAllByRole('listitem')).toHaveLength(4);
  },
);
