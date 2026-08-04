/**
 * Web Push subscription state (#310).
 *
 * WHY THIS ISN'T PURE SERVER STATE. Whether push is actually ON for this
 * browser lives in the Push API (`PushManager.getSubscription()`), not the
 * server — the server only knows which endpoints it has been told about, and
 * a browser can silently drop a subscription (permission revoked, storage
 * cleared) without ever telling the backend. So "is push on" is resolved by
 * asking the browser first, with the backend calls as a side effect of
 * turning it on/off rather than the source of truth for its state.
 *
 * `getPushPublicKey` (the one genuinely server-owned fact — is this
 * deployment configured at all) is the only piece routed through TanStack
 * Query, per the project convention for actual server state.
 *
 * @author Luca Ostinelli
 */

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
} from '../services/notificationService';

/** Converts the VAPID public key (base64url, as issued) into the Uint8Array PushManager expects. */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
};

export type PushSupportState = 'unsupported' | 'checking' | 'subscribed' | 'unsubscribed';

export function usePushNotifications() {
  const [state, setState] = useState<PushSupportState>(
    'serviceWorker' in navigator && 'PushManager' in window ? 'checking' : 'unsupported'
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const publicKeyQuery = useQuery({
    queryKey: ['push', 'public-key'],
    queryFn: async () => (await getPushPublicKey()).data ?? { enabled: false, publicKey: null },
    enabled: state !== 'unsupported',
  });

  useEffect(() => {
    if (state === 'unsupported') return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setState(sub ? 'subscribed' : 'unsubscribed');
      })
      .catch(() => {
        if (!cancelled) setState('unsubscribed');
      });
    return () => {
      cancelled = true;
    };
    // Runs once per mount; re-checking on every publicKeyQuery refetch would
    // fight the subscribe/unsubscribe calls below, which already set state directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === 'unsupported']);

  const subscribe = useCallback(async () => {
    if (!publicKeyQuery.data?.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notification permission was not granted.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // lib.dom's Uint8Array<ArrayBufferLike> vs BufferSource<ArrayBuffer> mismatch
        // is a TS-lib typing friction point, not a real runtime concern — a Uint8Array
        // is always valid here.
        applicationServerKey: urlBase64ToUint8Array(publicKeyQuery.data.publicKey) as BufferSource,
      });
      const json = subscription.toJSON();
      await subscribePush({
        endpoint: json.endpoint as string,
        keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
      });
      setState('subscribed');
    } catch (err) {
      setError((err as Error).message || 'Failed to enable push notifications.');
    } finally {
      setBusy(false);
    }
  }, [publicKeyQuery.data]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState('unsubscribed');
    } catch (err) {
      setError((err as Error).message || 'Failed to disable push notifications.');
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    error,
    busy,
    serverEnabled: publicKeyQuery.data?.enabled ?? false,
    subscribe,
    unsubscribe,
  };
}
