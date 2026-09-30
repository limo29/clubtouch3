import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/**
 * Feste 1920×1080-Bühne, per transform: scale() in den verfügbaren Platz eingepasst
 * (wie SlideRenderer). Achtung: position:fixed innerhalb der Bühne bezieht sich auf die Bühne –
 * Overlays daher außerhalb rendern.
 */
export default function TvStage({ children, background = '#0b0d12', sx }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setScale(Math.min(width / STAGE_W, height / STAGE_H));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <Box ref={wrapRef} sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: background, ...sx }}>
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale || 0.0001})`,
          transformOrigin: 'center center',
          visibility: scale ? 'visible' : 'hidden',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
