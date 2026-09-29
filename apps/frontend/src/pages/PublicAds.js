import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, CssBaseline, Typography, Fade, Slide, Zoom } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import api from '../services/api';
import SlideRenderer from '../components/ads/SlideRenderer';

/**
 * Öffentliches Werbe-Display (/public/ads), läuft ohne Login auf dem Bildschirm im Clubraum.
 * - holt die aktiven Slides alle 60 s; die Rotation läuft nur dann neu an, wenn sich wirklich etwas geändert hat
 * - nach einem Fehler oder einer leeren Liste wird nach 20 s erneut versucht
 * - Videos wechseln beim Ende weiter (spätestens nach der eingestellten Dauer)
 * - fehlende Medien (404) werden nach kurzer Zeit übersprungen statt als kaputtes Bild zu stehen
 */

const POLL_MS = 60 * 1000;
const RETRY_MS = 20 * 1000;
const TRANSITION_MS = 1000;
const MIN_DURATION_S = 2;

// Transition Wrapper
const Transition = ({ type, children, in: show, timeout }) => {
    switch (type) {
        case 'NONE': return show ? children : null;
        case 'SLIDE': return <Slide direction="left" in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Slide>;
        case 'ZOOM': return <Zoom in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Zoom>;
        case 'FADE':
        default: return <Fade in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Fade>;
    }
};

const isVideo = (url) => {
    if (!url) return false;
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(ext);
};

const Clock = () => {
    const [time, setTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <Box sx={{ position: 'absolute', top: 20, right: 30, zIndex: 9999, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
            <Typography variant="h3" fontWeight="800" color="white" sx={{ fontFamily: 'monospace' }}>
                {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </Typography>
        </Box>
    );
};

const theme = createTheme({
    palette: { mode: 'dark', background: { default: '#000' } },
    typography: { fontFamily: 'Inter, Roboto, sans-serif' }
});

// Nur die Felder vergleichen, die das Display beeinflussen
const fingerprint = (ads) => JSON.stringify(ads.map((a) => [a.id, a.imageUrl, a.duration, a.transition, a.order, a.updatedAt]));

export default function PublicAds() {
    const [ads, setAds] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [show, setShow] = useState(true);
    const [cycle, setCycle] = useState(0); // erzwingt einen Neustart der Timer (z.B. Video zu Ende, Medium fehlt)
    const fingerprintRef = useRef('');

    const fetchAds = useCallback(async () => {
        try {
            const res = await api.get('/public/ads');
            const list = Array.isArray(res.data) ? res.data : [];
            const fp = fingerprint(list);
            if (fp !== fingerprintRef.current) {
                fingerprintRef.current = fp;
                setAds(list);
                setCurrentIndex((i) => (list.length ? Math.min(i, list.length - 1) : 0));
            }
            setFailed(false);
            return list.length > 0;
        } catch (err) {
            console.error('Werbung konnte nicht geladen werden', err);
            setFailed(true);
            return false;
        } finally {
            setLoaded(true);
        }
    }, []);

    // Laden + Aktualisieren; bei Fehler/leer schneller erneut versuchen
    useEffect(() => {
        let timer;
        let cancelled = false;
        const tick = async () => {
            const ok = await fetchAds();
            if (cancelled) return;
            timer = setTimeout(tick, ok ? POLL_MS : RETRY_MS);
        };
        tick();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [fetchAds]);

    const currentAd = ads[currentIndex];

    const advance = useCallback(() => {
        setShow(false);
        setTimeout(() => {
            setCurrentIndex((prev) => (ads.length ? (prev + 1) % ads.length : 0));
            setShow(true);
        }, currentAd?.transition === 'NONE' ? 0 : TRANSITION_MS);
    }, [ads.length, currentAd?.transition]);

    // Rotation
    useEffect(() => {
        if (ads.length === 0 || !currentAd) return undefined;
        if (currentIndex >= ads.length) { setCurrentIndex(0); return undefined; }

        const durationMs = Math.max(MIN_DURATION_S, Number(currentAd.duration) || 10) * 1000;
        const useTransition = currentAd.transition !== 'NONE';
        const hideTimer = setTimeout(() => setShow(false), Math.max(0, durationMs - (useTransition ? TRANSITION_MS : 0)));
        const switchTimer = setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % ads.length);
            setShow(true);
        }, durationMs);

        return () => { clearTimeout(hideTimer); clearTimeout(switchTimer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, ads, cycle]);

    // Medium fehlt oder Video ist fertig → weiter
    const skipSoon = useCallback((delay = 1500) => {
        setTimeout(() => { advance(); setCycle((c) => c + 1); }, delay);
    }, [advance]);

    if (!loaded) return null;

    if (ads.length === 0 || !currentAd) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Clock />
                    <Box component="img" src="/assets/images/Logo.png" alt="" sx={{ width: 'min(40vw, 320px)', opacity: 0.9 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    <Typography variant="h5" color="text.secondary">
                        {failed ? 'Keine Verbindung zum Server – neuer Versuch in Kürze' : 'Keine aktive Werbung'}
                    </Typography>
                </Box>
            </ThemeProvider>
        );
    }

    // Preload next
    const nextAd = ads[(currentIndex + 1) % ads.length];
    const durationS = Math.max(MIN_DURATION_S, Number(currentAd.duration) || 10);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{
                height: '100vh', width: '100vw', overflow: 'hidden', bgcolor: '#000', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <Clock />

                <Transition type={currentAd.transition} in={show} timeout={TRANSITION_MS}>
                    <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isVideo(currentAd.imageUrl) ? (
                            <Box
                                key={currentAd.id}
                                component="video"
                                src={currentAd.imageUrl}
                                autoPlay
                                muted
                                playsInline
                                onEnded={() => skipSoon(0)}
                                onError={() => skipSoon()}
                                sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                            />
                        ) : (
                            currentAd.slideData ? (
                                <SlideRenderer slideData={currentAd.slideData} />
                            ) : (
                                <Box
                                    key={currentAd.id}
                                    component="img"
                                    src={currentAd.imageUrl}
                                    alt=""
                                    onError={() => skipSoon()}
                                    sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                                />
                            )
                        )}
                    </Box>
                </Transition>

                {/* Fortschrittsbalken */}
                {show && (
                    <Box
                        key={`${currentAd.id}-${cycle}`}
                        sx={{
                            position: 'absolute', bottom: 0, left: 0, height: 6, bgcolor: 'primary.main', width: '0%',
                            animation: `progress ${durationS}s linear forwards`
                        }}
                    />
                )}
                <style>{`@keyframes progress { from { width: 0%; } to { width: 100%; } }`}</style>

                {/* Vorladen des nächsten Mediums */}
                {nextAd && nextAd.id !== currentAd.id && (
                    <Box sx={{ display: 'none' }}>
                        {isVideo(nextAd.imageUrl) ? (
                            <video src={nextAd.imageUrl} preload="auto" muted />
                        ) : (
                            nextAd.slideData ? null : <img src={nextAd.imageUrl} alt="" />
                        )}
                    </Box>
                )}
            </Box>
        </ThemeProvider>
    );
}
