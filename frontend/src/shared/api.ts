export class ApiError extends Error {
  constructor(
    public code: string,
    public fields: Record<string, string> = {},
  ) {
    super(code);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('invalid_response');
  }
  return Object.fromEntries(Object.entries(value));
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('invalid_response');
  return value;
}
export async function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = object(await response.json());
  if (!response.ok) {
    const fields = data['fields'];
    const errors: Record<string, string> = {};
    if (fields && typeof fields === 'object') {
      for (const key of Object.keys(fields)) errors[key] = 'Vérifiez ce champ.';
    }
    throw new ApiError(string(data['code']), errors);
  }
  return data;
}
export interface Configuration {
  rootDomain: string;
  publicOrigin: string;
  tenant: string | null;
  termsVersion: string;
}
export async function configuration(): Promise<Configuration> {
  const data = await request('/config');
  const tenant = data['tenant'];
  return {
    rootDomain: string(data['root_domain']),
    publicOrigin: string(data['public_origin']),
    termsVersion: string(data['terms_version']),
    tenant: tenant === null ? null : string(tenant),
  };
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'Email ou mot de passe incorrect.';
      case 'slug_unavailable':
        return 'Cet espace est déjà réservé. Choisissez un autre nom.';
      case 'rate_limited':
        return 'Trop de tentatives. Réessayez dans 15 minutes.';
      case 'invalid_token':
        return 'Ce lien est invalide ou a expiré. Demandez un nouvel email.';
      case 'invalid_input':
        return 'Vérifiez les champs indiqués.';
      case 'invalid_host':
      case 'unknown_tenant':
        return 'Cet espace d’entreprise est introuvable ou n’est pas encore actif.';
    }
  }
  return 'Le service est indisponible. Veuillez réessayer.';
}
