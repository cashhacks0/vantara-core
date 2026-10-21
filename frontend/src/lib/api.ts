export class ApiError extends Error {
  status: number;
  hint?: string;
  payload?: unknown;
  constructor(message: string, status: number, hint?: string, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.payload = payload;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractError(detail: unknown, status: number): ApiError {
  if (typeof detail === 'string') return new ApiError(detail, status, undefined, detail);
  if (detail && typeof detail === 'object') {
    const value = detail as Record<string, unknown>;
    const message =
      (typeof value.error === 'string' && value.error) ||
      (typeof value.message === 'string' && value.message) ||
      (Array.isArray(value.errors) && (value.errors as string[]).join('; ')) ||
      (typeof value.detail === 'string' && value.detail) ||
      `Request failed (${status})`;
    return new ApiError(String(message), status, typeof value.hint === 'string' ? value.hint : undefined, detail);
  }
  return new ApiError(`Request failed (${status})`, status);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* non-JSON error body */
    }
    const detail = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).detail : payload;
    throw extractError(detail ?? response.statusText, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) };
}

export async function uploadFile<T>(path: string, file: File, signal?: AbortSignal): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return api<T>(path, { method: 'POST', body: form, signal });
}

export interface SSEHandler {
  (event: Record<string, unknown>): void;
}

export async function streamSSE(
  path: string,
  body: unknown,
  onEvent: SSEHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* ignore */ }
    const detail = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).detail : payload;
    throw extractError(detail ?? response.statusText, response.status);
  }
  if (!response.body) throw new ApiError('Streaming is not supported by this browser.', 500);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const dataLines = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
      if (!dataLines.length) continue;
      const data = dataLines.join('\n');
      if (data === '[DONE]') return;
      try {
        onEvent(JSON.parse(data) as Record<string, unknown>);
      } catch {
        /* ignore malformed keepalive payloads */
      }
    }
  }
}

export async function streamRunEvents(
  runId: string,
  onEvent: SSEHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/workflow-runs/${runId}/events`, { signal });
  if (!response.ok) throw new ApiError('Could not subscribe to run events.', response.status);
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      if (!data) continue;
      try { onEvent(JSON.parse(data) as Record<string, unknown>); } catch { /* ignore */ }
    }
  }
}
