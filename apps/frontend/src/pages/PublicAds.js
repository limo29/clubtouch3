import React, { useEffect, useState } from 'react';
import { Box, CssBaseline, Typography, Fade, Slide, Zoom } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import api from '../services/api';
import SlideRenderer from '../components/ads/SlideRenderer';

// Transition Wrapper
const Transition = ({ type, children, in: show, timeout }) => {
    switch (type) {
        case 'SLIDE': return <Slide direction="left" in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Slide>;
        case 'ZOOM': return <Zoom in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Zoom>;
        case 'FADE':
        default: return <Fade in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Fade>;
    }
};

const isVideo = (url) => {
    if (!url) return false;
    const ext = url.split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
};

const Clock = () => {
    const [time, setTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <Box sx={{
            position: 'absolute',
            top: 20,
            right: 30,
            zIndex: 9999,
            textShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}>
            <Typography variant="h3" fontWeight="800" color="white" sx={{ fontFamily: 'monospace' }}>
                {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
        </Box>
    );
};

export default function PublicAds() {
    const [ads, setAds] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [show, setShow] = useState(true);

    // Fetch Ads
    useEffect(() => {
        const fetchAds = async () => {
            try {
                const res = await api.get('/public/ads');
                setAds(res.data || []);
            } catch (err) {
                console.error("Failed to fetch ads", err);
            } finally {
                setLoading(false);
            }
        };
        fetchAds();
        // Refresh ads every 5 minutes to get updates without reload
        const interval = setInterval(fetchAds, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const currentAd = ads[currentIndex];

    // Cycle Ads
    useEffect(() => {
        if (ads.length === 0) return;

        // Ensure we handle updates where list shrinks
        if (currentIndex >= ads.length) {
            setCurrentIndex(0);
            return;
        }

        const duration = (currentAd?.duration || 10) * 1000;
        const transitionTime = 1000; // 1s transition

        // Timer to hide current
        const hideTimer = setTimeout(() => {
            setShow(false);
        }, duration - transitionTime);

        // Timer to switch and show next
        const switchTimer = setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % ads.length);
            setShow(true);
        }, duration);

        return () => {
            clearTimeout(hideTimer);
            clearTimeout(switchTimer);
        };
    }, [currentIndex, ads, currentAd]);

    const theme = createTheme({
        palette: {
            mode: 'dark',
            background: { default: '#000' } // Pure black for ads
        },
        typography: {
            fontFamily: 'Inter, Roboto, sans-serif'
        }
    });

    if (loading) return null;
    if (ads.length === 0) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="h4" color="text.secondary">Keine Werbung verfügbar</Typography>
                </Box>
            </ThemeProvider>
        );
    }

    if (!currentAd) return null;

    // Preload next
    const nextAd = ads[(currentIndex + 1) % ads.length];

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{
                height: '100vh',
                width: '100vw',
                overflow: 'hidden',
                bgcolor: '#000',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <Clock />

                <Transition type={currentAd.transition} in={show} timeout={1000}>
                    <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isVideo(currentAd.imageUrl) ? (
                            <Box
                                component="video"
                                src={currentAd.imageUrl}
                                autoPlay
                                muted
                                playsInline
                                sx={{
                                    maxWidth: '100%',
                                    maxHeight: '100%',
                                    objectFit: 'contain',
                                    display: 'block'
                                }}
                            />
                        ) : (
                            currentAd.slideData ? (
                                <SlideRenderer slideData={currentAd.slideData} />
                            ) : (
                                <Box
                                    component="img"
                                    src={currentAd.imageUrl}
                                    alt="Advertisement"
                                    sx={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        objectFit: 'contain',
                                        display: 'block'
                                    }}
                                />
                            )
                        )}
                    </Box>
                </Transition>

                {/* Progress Bar */}
                {show && (
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            height: 6,
                            bgcolor: 'primary.main',
                            width: '0%',
                            animation: `progress ${currentAd.duration}s linear forwards`
                        }}
                    />
                )}
                <style>
                    {`
                        @keyframes progress {
                            from { width: 0%; }
                            to { width: 100%; }
                        }
                    `}
                </style>

                {/* Preloader */}
                <Box sx={{ display: 'none' }}>
                    {isVideo(nextAd.imageUrl) ? (
                        <video src={nextAd.imageUrl} preload="auto" />
                    ) : (
                        nextAd.slideData ? null : <img src={nextAd.imageUrl} alt="preload" />
                    )}
                </Box>

            </Box>
        </ThemeProvider>
    );
}
