import React, { useRef, useState, useEffect } from 'react';
import { Box } from '@mui/material';
import SlideElement from './SlideElement';

export default function SlideRenderer({ slideData }) {
    const containerRef = useRef(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                const scaleX = clientWidth / 1920;
                const scaleY = clientHeight / 1080;
                // Fit into container (contain)
                setScale(Math.min(scaleX, scaleY));
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        // Initial delay to ensure container is ready
        setTimeout(handleResize, 100);

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (!slideData) return null;

    let data = slideData;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (e) {
            console.error("Invalid slide data", e);
            return null;
        }
    }

    const { elements, bgColor, bgImage } = data;

    return (
        <Box
            ref={containerRef}
            sx={{
                width: '100%',
                height: '100%',
                bgcolor: bgColor || '#000',
                backgroundImage: bgImage ? `url(${bgImage})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            <Box sx={{
                width: 1920,
                height: 1080,
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) scale(${scale})`,
                transformOrigin: 'center',
                flexShrink: 0
            }}>
                {elements && elements.map(el => (
                    <Box key={el.id} sx={{
                        position: 'absolute',
                        left: parseInt(el.x),
                        top: parseInt(el.y),
                        width: parseInt(el.width),
                        height: parseInt(el.height),
                        zIndex: el.zIndex,
                        // Rnd handles rotation in style, but we store it in element.rotation
                        // In SlideEditor, Rnd applies transform (translate).
                        // We need to match Rnd's output. Rnd puts {transform: translate(x,y)} on the wrapper.
                        // Elements have rotation inside content? No, in SlideElement style.
                    }}>
                        <SlideElement element={el} />
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
