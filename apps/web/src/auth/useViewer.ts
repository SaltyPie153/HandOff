import { useEffect, useState } from 'react';
import type { Viewer } from './api';

export function useViewer(enabled = true) {
  const [state, setState] = useState<{ loading: boolean; viewer: Viewer | null; unavailable: boolean }>({ loading: true, viewer: null, unavailable: false });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch('/api/auth/me', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { setState({ loading: false, viewer: null, unavailable: false }); return; }
        if (!response.ok) throw new Error('Unavailable');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !('status' in body) || !['PENDING', 'APPROVED'].includes(String(body.status)) || !('linkedProviders' in body) || !Array.isArray(body.linkedProviders)) throw new Error('Invalid viewer');
        setState({ loading: false, viewer: body as Viewer, unavailable: false });
      }).catch(() => { if (!controller.signal.aborted) setState({ loading: false, viewer: null, unavailable: true }); });
    return () => controller.abort();
  }, [enabled]);
  return state;
}
