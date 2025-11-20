import React, { useEffect, useState } from 'react';
import { Box, CssBaseline, Typography, Fade, Slide, Zoom } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import api from '../services/api';

// Transition Wrapper
const Transition = ({ type, children, in: show, timeout }) => {
    switch (type) {
        case 'SLIDE': return <Slide direction="left" in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Slide>;
        case 'ZOOM': return <Zoom in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Zoom>;
        case 'FADE':
        default: return <Fade in={show} timeout={timeout} mountOnEnter unmountOnExit>{children}</Fade>;
    }
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

    // Cycle Ads
    useEffect(() => {
        if (ads.length === 0) return;

        const currentAd = ads[currentIndex];
        const duration = (currentAd.duration || 10) * 1000;
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
    }, [currentIndex, ads]);

    const theme = createTheme({
        palette: {
            mode: 'dark',
            background: { default: '#000' } // Pure black for ads
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

    const currentAd = ads[currentIndex];

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
                <Transition type={currentAd.transition} in={show} timeout={1000}>
                    <Box
                        component="img"
                        src={currentAd.imageUrl}
                        alt="Advertisement"
                        sx={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain', // Ensure full image is visible
                            display: 'block'
                        }}
                    />
                </Transition>
            </Box>
        </ThemeProvider>
    );
}
