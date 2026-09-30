/**
 * Wischbare Warenkorb-Zeile (nur für mode="sale").
 *
 * Wisch nach links enthüllt einen roten „Entfernen"-Bereich hinter der Zeile.
 * Wird der Wisch ≥ DELETE_RATIO der Zeilenbreite losgelassen, fliegt die Zeile
 * heraus und onRemove() wird aufgerufen. Andernfalls federt sie zurück.
 *
 * Nur Touch-Eingaben (pointerType === 'touch'); Maus-Klicks bleiben unverändert.
 *
 * Richtungsverriegelung:
 *   • Erst wenn |dx| > LOCK_THRESHOLD px UND |dx| > |dy|, gilt der Wisch als
 *     horizontal → Pointer wird eingefangen (Buttons unterhalb bekommen kein Click).
 *   • Andernfalls (vertikal oder Rechtswisch) bleibt natürliches Scrollen aktiv.
 *   • touch-action: pan-y am Wrapper stellt sicher, dass der Browser vertikales
 *     Scrollen verarbeiten kann, solange die Richtung noch nicht festgelegt ist.
 */
import React, { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';

/** Mindest-Wischstrecke (px) vor Richtungsverriegelung */
const LOCK_THRESHOLD = 10;
/** Anteil der Zeilenbreite, ab dem die Zeile gelöscht wird */
const DELETE_RATIO = 0.4;
/** Animationsdauer (ms) */
const ANIM_MS = 250;

export default function SwipeableLine({ children, onRemove }) {
  const rowRef = useRef(null);

  /**
   * Zeiger-Zustand außerhalb von React-State, damit pointermove-Handler
   * keine Closure-Probleme mit veralteten Werten hat.
   * Felder: pointerId, startX, startY, locked ('h'|'v'|null), currentOffset
   */
  const pRef = useRef(null);

  const [offset, setOffset] = useState(0);     // px-Verschiebung des Vordergrunds
  const [animating, setAnimating] = useState(false); // CSS-Transition aktiv?
  const [flyOut, setFlyOut] = useState(false);  // fliegt gerade heraus?

  const handlePointerDown = (e) => {
    if (e.pointerType !== 'touch') return;
    if (pRef.current) return; // bereits eine Geste aktiv
    pRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      locked: null,
      currentOffset: 0,
    };
    // Transition während der Geste deaktivieren
    setAnimating(false);
    setFlyOut(false);
  };

  const handlePointerMove = (e) => {
    const s = pRef.current;
    if (!s || e.pointerId !== s.pointerId) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (!s.locked) {
      // Schwelle noch nicht erreicht – noch zu wenig Bewegung
      if (Math.abs(dx) <= LOCK_THRESHOLD && Math.abs(dy) <= LOCK_THRESHOLD) return;

      // Vertikal oder Rechtswisch → Scrollen freigeben, keine Wischaktion
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) {
        s.locked = 'v';
        return;
      }

      // Linkswisch bestätigt → Pointer einfangen, damit Buttons kein Click erhalten
      s.locked = 'h';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }

    if (s.locked !== 'h') return;

    // Nur Linksbewegung (negatives dx) zulassen
    const clamped = Math.min(0, dx);
    s.currentOffset = clamped;
    setOffset(clamped);
  };

  const handlePointerUp = (e) => {
    const s = pRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    pRef.current = null; // Geste beenden

    if (s.locked !== 'h') return;

    const width = rowRef.current?.offsetWidth || 300;
    const travelled = Math.abs(s.currentOffset);

    if (travelled >= width * DELETE_RATIO) {
      // Schwelle überschritten → Zeile fliegt heraus, dann entfernen
      setFlyOut(true);
      setAnimating(true);
      setTimeout(onRemove, ANIM_MS);
    } else {
      // Nicht weit genug → zurückfedern
      setAnimating(true);
      setOffset(0);
    }
  };

  const handlePointerCancel = () => {
    pRef.current = null;
    setAnimating(true);
    setOffset(0);
  };

  return (
    <Box ref={rowRef} sx={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}>

      {/* Roter Löschbereich – liegt hinter der Zeile */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: 'error.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          px: 2,
          gap: 0.75,
        }}
      >
        <DeleteOutline sx={{ color: '#fff', fontSize: 28 }} />
        <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem', userSelect: 'none' }}>
          Entfernen
        </Typography>
      </Box>

      {/* Vordergrundzeile – folgt dem Finger / federt zurück / fliegt heraus */}
      <Box
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        sx={{
          transform: flyOut
            ? 'translateX(-110%)'
            : `translateX(${offset}px)`,
          transition: animating ? `transform ${ANIM_MS}ms ease` : 'none',
          bgcolor: 'background.paper',
          willChange: 'transform',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
