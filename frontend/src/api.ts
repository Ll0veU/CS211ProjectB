export class ApiError extends Error {
  constructor(
    public code: string,
    public detail: string
  ) {
    super(detail);
  }
}

export async function api<Result>(
  path: string,
  token: string,
  body?: unknown
): Promise<Result> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-ProjectB-Client': window.ProjectB ? 'android' : 'desktop',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json()) as { code?: string; error?: string };
    throw new ApiError(
      error.code ?? 'request_failed',
      error.error ?? `HTTP ${response.status}`
    );
  }
  return response.json() as Promise<Result>;
}

export async function download(path: string, token: string, filename: string) {
  if (window.ProjectB?.exportFile) {
    window.ProjectB.exportFile(path, token);
    return;
  }
  const response = await fetch(`/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new ApiError('download_failed', `HTTP ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
