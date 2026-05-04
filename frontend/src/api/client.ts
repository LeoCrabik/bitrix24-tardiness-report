declare const BX24: {
  init: (cb: () => void) => void;
  getAuth: () => { domain: string; user_id?: number; access_token?: string };
};

let _domain      = '';
let _accessToken = '';

export function initBX24(): Promise<void> {
  return new Promise((resolve, reject) => {
    const urlParams     = new URLSearchParams(window.location.search);
    const tokenFromUrl  = urlParams.get('bx_auth') || '';
    const domainFromUrl = urlParams.get('DOMAIN') || '';

    // Если proxy уже передал domain и token через URL — используем сразу,
    // не ждём BX24.init() (он зависает в нашей redirect-схеме)
    if (tokenFromUrl && domainFromUrl) {
      _domain      = domainFromUrl;
      _accessToken = tokenFromUrl;

      urlParams.delete('bx_auth');
      const newSearch = urlParams.toString();
      window.history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : ''));

      resolve();
      return;
    }

    // Фолбэк: стандартный SDK-путь (без нашего редиректа)
    const timeout = setTimeout(() => {
      reject(new Error('Приложение должно открываться из Битрикс24'));
    }, 6000);

    BX24.init(() => {
      clearTimeout(timeout);
      const auth   = BX24.getAuth();
      _domain      = auth.domain || domainFromUrl;
      _accessToken = auth.access_token || '';

      if (!_domain || !_accessToken) {
        reject(new Error(
          `Не удалось получить данные авторизации. domain="${_domain}", token="${_accessToken ? 'set' : 'empty'}"`
        ));
        return;
      }
      resolve();
    });
  });
}

export function getDomain() { return _domain; }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-bitrix-domain':       _domain,
      'x-bitrix-access-token': _accessToken,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserInfo {
  userId: string;
  role: 'admin' | 'manager' | 'employee';
}

export interface User {
  id: string;
  name: string;
  position: string;
  photo: string | null;
  isAdmin: boolean;
}

export interface Settings {
  id: string;
  trackedUsers: string[];
  managers: string[];
  lateThreshold: number;
  schedule: Record<string, { enabled: boolean; start: string; end: string }>;
}

export interface TardinessRecord {
  id: string;
  userId: string;
  date: string;
  actualStart: string;
  planStart: string;
  lateMinutes: number;
  reason: string;
  reasonStatus: 'NONE' | 'PENDING' | 'ACCEPTED' | 'REJECTED';
  managerId: string | null;
  resolvedAt: string | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const api = {
  getMe: () => request<UserInfo>('/me'),

  getUsers: () => request<User[]>('/users'),

  getSettings: () => request<Settings>('/settings'),

  saveSettings: (data: Omit<Settings, 'id'>) =>
    request<{ ok: boolean }>('/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getReport: (params: { dateFrom?: string; dateTo?: string; userIds?: string[] }) => {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.userIds?.length) qs.set('userIds', params.userIds.join(','));
    return request<TardinessRecord[]>(`/report?${qs}`);
  },

  getExportUrl: (params: { dateFrom?: string; dateTo?: string; userIds?: string[] }) => {
    const qs = new URLSearchParams();
    qs.set('domain', _domain);
    qs.set('token', _accessToken);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.userIds?.length) qs.set('userIds', params.userIds.join(','));
    return `/api/report/export?${qs}`;
  },

  updateReasonStatus: (id: string, status: 'ACCEPTED' | 'REJECTED') =>
    request<{ ok: boolean }>(`/tardiness/${id}/reason-status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  getMyTardiness: (params: { dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    return request<TardinessRecord[]>(`/my-tardiness?${qs}`);
  },

  submitReason: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/my-tardiness/${id}/reason`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
