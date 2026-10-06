'use client';

import { useEffect } from 'react';

const AGENDA_PRO_URL = 'https://agenda-pro-iucw.vercel.app/';

export default function AgendaRecoveryRedirect() {
  useEffect(() => {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

    const type = query.get('type') || fragment.get('type');
    const isRecovery =
      type === 'recovery' ||
      query.has('token_hash') ||
      query.has('code') ||
      fragment.has('access_token') ||
      fragment.has('refresh_token');

    if (!isRecovery) return;

    window.location.replace(AGENDA_PRO_URL + search + hash);
  }, []);

  return null;
}
