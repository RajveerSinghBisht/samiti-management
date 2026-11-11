export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch CSRF token');
  }
  const data = (await res.json()) as { csrfToken: string };
  return data.csrfToken;
}

export async function apiMutate<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body: unknown
): Promise<T> {
  const csrfToken = await fetchCsrfToken();
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

