import { useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string | undefined;
  suffix?: ReactNode;
}
export function Field({ label, name, error, suffix, type, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <div className="input-row">
        <input
          {...props}
          id={name}
          name={name}
          type={type === 'password' && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        {type === 'password' && (
          <button
            className="reveal"
            type="button"
            aria-label={
              visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
            }
            onClick={() => setVisible(!visible)}
          >
            {visible ? 'Masquer' : 'Afficher'}
          </button>
        )}
      </div>
      {error && (
        <span id={`${name}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
