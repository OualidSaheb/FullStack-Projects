import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { qk } from './queries';

const PREF_KEY = 'touraya:notify';

/** Per-device preference (each agent decides on their own phone). */
export function useNotifyPref() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PREF_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(async () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(PREF_KEY, next ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    if (next && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    if (next) unlockAudio();
  }, [on]);
  return [on, toggle] as const;
}

let audio: AudioContext | null = null;
/** Browsers only allow sound after a user gesture: create/resume the audio context on the first tap. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** Short two-tone "ding" generated in the browser (no sound file to download). */
function ding() {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.4);
  }
}

/**
 * Live updates from the server (Server-Sent Events): new orders ring and show a
 * notification, and every open screen refreshes when an order changes.
 * The browser reconnects by itself after a network drop.
 */
export function useLiveEvents(enabled: boolean, notify: boolean) {
  const qc = useQueryClient();
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const onGesture = () => notifyRef.current && unlockAudio();
    window.addEventListener('pointerdown', onGesture);
    return () => window.removeEventListener('pointerdown', onGesture);
  }, []);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events/stream');
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const refreshOrders = () => {
      clearTimeout(refresh);
      refresh = setTimeout(() => qc.invalidateQueries({ queryKey: qk.orders }), 400);
    };

    source.addEventListener('order.created', () => {
      pending.current++;
      refreshOrders();
      // Leads often arrive in batches: one alert per batch.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const n = pending.current;
        pending.current = 0;
        const text = n === 1 ? 'طلبية جديدة' : `${n} طلبيات جديدة`;
        toast.success(text);
        if (!notifyRef.current) return;
        ding();
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Touraya CRM', { body: text, icon: '/favicon.svg', tag: 'new-orders' });
        }
      }, 1500);
    });
    source.addEventListener('order.status_changed', refreshOrders);
    return () => {
      clearTimeout(refresh);
      source.close();
    };
  }, [enabled, qc]);
}
