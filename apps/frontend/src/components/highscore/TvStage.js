import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

// fluid: Breite der Bühne folgt dem Seitenverhältnis des Bildschirms, in diesen Grenzen (4:3 bis 21:9)
const FLUID_MIN_W = 1440;
const FLUID_MAX_W = 2520;

/**
 * 1080 Pixel hohe Bühne, per transform: scale() in den verfügbaren Platz eingepasst (wie SlideRenderer).
 * Standard ist fest 1920×1080 (16:9, Rest bleibt Rand). Mit `fluid` wird die Bühne so breit wie der
 * Bildschirm es hergibt: ein 16:10-, 5:4- oder 21:9-Monitor ist dann ohne Ränder gefüllt, der Inhalt
 * (Flex-/Grid-Layout) verteilt sich auf die Breite. Achtung: position:fixed innerhalb der Bühne bezieht
 * sich auf die Bühne – Overlays daher außerhalb rendern.
 */
export default function TvStage({ children, background = '#0b0d12', fluid = false, sx }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [stageW, setStageW] = useState(STAGE_W);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!(width > 0 && height > 0)) return;
      const w = fluid ? Math.min(FLUID_MAX_W, Math.max(FLUID_MIN_W, Math.round((STAGE_H * width) / height))) : STAGE_W;
      setStageW(w);
      setScale(Math.min(width / w, height / STAGE_H));
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
  }, [fluid]);

  return (
    <Box ref={wrapRef} sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: background, ...sx }}>
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: stageW,
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
