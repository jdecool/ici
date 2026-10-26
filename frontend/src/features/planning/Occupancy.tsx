import type { ReactNode } from 'react';
import { add, days, fullName, halves, occupancy } from './model';
import type { Week } from './model';
export function Occupancy({
  week,
  day,
  renderLocation,
}: {
  week: Week;
  day: number;
  renderLocation: (id: string) => ReactNode;
}) {
  const selected = add(week.start, day);
  const max = Math.max(
    1,
    ...week.locations.flatMap((l) =>
      week.work_days.flatMap((d) =>
        halves.map((h) => occupancy(week, l.id, add(week.start, d), h).length),
      ),
    ),
  );
  return (
    <div className="location-grid">
      {week.locations.map((location) => {
        const am = occupancy(week, location.id, selected, 'am');
        const pm = occupancy(week, location.id, selected, 'pm');
        const present = week.users.filter(
          (u) => am.includes(u) || pm.includes(u),
        );
        return (
          <article
            key={location.id}
            className="workspace-card"
            aria-label={`Occupation ${location.name}`}
          >
            {renderLocation(location.id)}
            <p>
              <strong>{am.length}</strong> le matin ·{' '}
              <strong>{pm.length}</strong> l’après-midi
            </p>
            <div
              className="occupancy-chart"
              aria-label={`Occupation hebdomadaire ${location.name}`}
            >
              {week.work_days.map((d) => {
                const morning = occupancy(
                  week,
                  location.id,
                  add(week.start, d),
                  'am',
                ).length;
                const afternoon = occupancy(
                  week,
                  location.id,
                  add(week.start, d),
                  'pm',
                ).length;
                // Stryker disable next-line OptionalChaining: The API validates weekday indexes to 0–6, so every configured day has a label.
                const label = days[d]?.slice(0, 3);
                return (
                  <div
                    key={d}
                    className={day === d ? 'selected-day' : undefined}
                  >
                    <div className="occupancy-bars">
                      <span
                        title={`Matin : ${morning}`}
                        style={{
                          height: `${Math.max(2, (morning / max) * 72)}px`,
                        }}
                      />
                      <span
                        title={`Après-midi : ${afternoon}`}
                        style={{
                          height: `${Math.max(2, (afternoon / max) * 72)}px`,
                        }}
                      />
                    </div>
                    <small>{label}</small>
                    <span className="sr-only">
                      {`: ${morning} matin, ${afternoon} après-midi`}
                    </span>
                  </div>
                );
              })}
            </div>
            <h4>
              Présents le{' '}
              {new Date(`${selected}T12:00:00`).toLocaleDateString('fr-FR')}
            </h4>
            {!present.length ? (
              <p>Aucune présence renseignée.</p>
            ) : (
              <ul>
                {present.map((u) => (
                  <li key={u.id}>{fullName(u)}</li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
