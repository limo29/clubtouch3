import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { WS_URL } from '../config/api';

export const SCREEN_CONTENT_LABELS = { highscore: 'Clubscore', ads: 'Werbung', sales: 'Verkauf', none: 'nichts' };
export const SCREEN_KEY = 'clubtouch.screenNo'; // sessionStorage: dieses Fenster ist „Bildschirm N“

/**
 * Belegung der Bildschirme (Nummer → highscore | ads | sales), live per Socket und alle 60 s als Rückfall.
 * `identify` zählt hoch, wenn in der App „Nummern einblenden“ gedrückt wurde.
 * Liefert `screens: null`, solange noch nichts geladen ist.
 */
export default function useScreenAssignment(enabled = true) {
  const [screens, setScreens] = useState(null);
  const [identify, setIdentify] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () => api.get('/public/screens')
      .then((res) => { if (!cancelled) setScreens(res.data?.screens || {}); })
      .catch(() => { /* offline: letzte bekannte Belegung behalten */ });
    load();
    const poll = setInterval(load, 60 * 1000);
    const socket = io(WS_URL);
    socket.on('connect', load);
    socket.on('screens:update', (msg) => { if (msg?.screens) setScreens(msg.screens); });
    socket.on('screens:identify', () => setIdentify((n) => n + 1));
    return () => { cancelled = true; clearInterval(poll); socket.disconnect(); };
  }, [enabled]);

  return { screens, identify };
}
