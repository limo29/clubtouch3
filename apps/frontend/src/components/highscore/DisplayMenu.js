import React, { useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Divider } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import HistoryIcon from '@mui/icons-material/History';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

/**
 * ⋮-Menü der internen Clubscore-Leiste, nur für Seltenes: Archiv und (Admin) „Jahr zurücksetzen“ mit Rückfrage.
 * Anzeige-Einstellungen, „Anzeige öffnen“ und „Bildschirme“ stehen sichtbar in der Leiste (DisplayPageBar).
 * onOpenChange hält die Leiste im Vollbild sichtbar.
 */
export default function DisplayMenu({ isAdmin, onArchive, onReset, onOpenChange }) {
  const [anchor, setAnchor] = useState(null);
  const open = (e) => { setAnchor(e.currentTarget); onOpenChange?.(true); };
  const close = () => { setAnchor(null); onOpenChange?.(false); };
  const run = (fn) => () => { close(); fn?.(); };
  const label = isAdmin ? 'Mehr: Archiv, Jahr zurücksetzen' : 'Mehr: Archiv';

  return (
    <>
      <Tooltip title={label}>
        <IconButton onClick={open} aria-label={label} sx={{ width: 40, height: 40 }} aria-haspopup="menu" aria-expanded={!!anchor}>
          <MoreVertIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={run(onArchive)}>
          <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Archiv" secondary="Frühere Jahreswertungen" />
        </MenuItem>
        {isAdmin && <Divider />}
        {isAdmin && (
          <MenuItem onClick={run(onReset)} sx={{ color: 'warning.main' }}>
            <ListItemIcon><RestartAltIcon fontSize="small" color="warning" /></ListItemIcon>
            <ListItemText primary="Jahr zurücksetzen" />
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
