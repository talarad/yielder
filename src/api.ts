import type {
  CompareResult,
  Entry,
  FundDetail,
  FundInput,
  FundSummary,
  ImportCommitFund,
  ImportPreview,
  ImportResult,
  Period,
  Portfolio,
  User,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason from the server, used to show a localized message. */
    public code?: string,
    /** For validation errors: the field that failed. */
    public field?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (raw) {
    headers['Content-Type'] = 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));

    throw new ApiError(res.status, data.error ?? res.statusText, data.code, data.field);
  }

  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  me: () => request<User>('GET', '/auth/me'),
  login: (username: string, password: string) => request<User>('POST', '/auth/login', { username, password }),
  register: (body: { username: string; password: string; displayName?: string; shareAnonymously: boolean }) =>
    request<User>('POST', '/auth/register', body),
  logout: () => request<void>('POST', '/auth/logout'),
  updateMe: (patch: { displayName?: string; shareAnonymously?: boolean }) => request<User>('PATCH', '/auth/me', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/auth/password', { currentPassword, newPassword }),
  deleteAccount: (password: string) => request<void>('DELETE', '/auth/me', { password }),

  funds: () => request<FundSummary[]>('GET', '/funds'),
  fund: (id: number) => request<FundDetail>('GET', `/funds/${id}`),
  createFund: (input: FundInput) => request<FundSummary>('POST', '/funds', input),
  updateFund: (id: number, patch: Partial<FundInput>) => request<FundDetail>('PATCH', `/funds/${id}`, patch),
  deleteFund: (id: number) => request<void>('DELETE', `/funds/${id}`),
  saveEntry: (id: number, { month, ...body }: Entry) => request<FundDetail>('PUT', `/funds/${id}/entries/${month}`, body),
  deleteEntry: (id: number, month: string) => request<FundDetail>('DELETE', `/funds/${id}/entries/${month}`),
  setRangeFlows: (id: number, body: { from: string; to: string; deposit?: number; withdrawal?: number }) =>
    request<FundDetail>('PATCH', `/funds/${id}/entries`, body),

  portfolio: () => request<Portfolio>('GET', '/portfolio'),
  compare: (period: Period) => request<CompareResult>('GET', `/compare?period=${period}`),

  importPreview: (file: File) => request<ImportPreview>('POST', '/import/preview', undefined, file),
  importCommit: (funds: ImportCommitFund[]) => request<ImportResult>('POST', '/import/commit', { funds }),
  exportUrl: '/api/export',
  templateUrl: '/api/template',
};
