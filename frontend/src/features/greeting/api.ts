export async function fetchGreeting(): Promise<string> {
  const response = await fetch('/api/hello');
  if (!response.ok) {
    throw new Error('Unable to load greeting');
  }
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('message' in body) ||
    typeof body.message !== 'string'
  ) {
    throw new Error('Invalid greeting response');
  }
  return body.message;
}
