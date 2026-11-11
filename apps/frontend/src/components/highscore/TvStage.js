import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

// fluid: Breite der Bühne folgt dem Seitenverhältnis des Bildschirms bis 21:9. Schmaler als 1600 (≈ 3:2) wird
// sie nicht: auf 4:3- und 5:4-Monitoren wächst sie stattdessen in die Höhe, sonst würden die Namen abgeschnitten.
const FLUID_MIN_W = 1600;
const FLUID_MAX_W = 2520;

/**
 * 1080 Pixel hohe Bühne, per transform: scale() in den verfügbaren Platz eingepasst (wie SlideRenderer).
 * Standard ist fest 1920×1080 (16:9, Rest bleibt Rand). Mit `fluid` folgt die Bühne dem Seitenverhältnis:
 * ein 16:10- oder 21:9-Monitor ist ohne Ränder gefüllt (Breite 1728 … 2520 bei 1080 Höhe), ein 4:3- oder
 * 5:4-Monitor bekommt eine 1600 breite und entsprechend höhere Bühne. Der Inhalt (Flex-/Grid-Layout)
 * verteilt sich auf die Fläche. Achtung: position:fixed innerhalb der Bühne bezieht
 * sich auf die Bühne – Overlays daher außerhalb rendern.
 */
export default function TvStage({ children, background = '#0b0d12', fluid = false, sx }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [stageW, setStageW] = useState(STAGE_W);
  const [stageH, setStageH] = useState(STAGE_H);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!(width > 0 && height > 0)) return;
      const natural = Math.round((STAGE_H * width) / height);
      const w = fluid ? Math.min(FLUID_MAX_W, Math.max(FLUID_MIN_W, natural)) : STAGE_W;
      const h = fluid && natural < FLUID_MIN_W ? Math.round((FLUID_MIN_W * height) / width) : STAGE_H;
      setStageW(w);
      setStageH(h);
      setScale(Math.min(width / w, height / h));
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
          height: stageH,
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
