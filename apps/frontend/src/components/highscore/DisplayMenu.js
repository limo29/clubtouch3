import React, { useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Divider } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TuneIcon from '@mui/icons-material/Tune';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import HistoryIcon from '@mui/icons-material/History';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

/** ⋮-Menü der internen Clubscore-Leiste für seltene Aktionen. onOpenChange hält die Leiste im Vollbild sichtbar. */
export default function DisplayMenu({ canEditDisplay, isAdmin, onDisplay, onArchive, onReset, onOpenChange }) {
  const [anchor, setAnchor] = useState(null);
  const open = (e) => { setAnchor(e.currentTarget); onOpenChange?.(true); };
  const close = () => { setAnchor(null); onOpenChange?.(false); };
  const run = (fn) => () => { close(); fn?.(); };

  return (
    <>
      <Tooltip title="Weitere Aktionen">
        <IconButton onClick={open} aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded={!!anchor}>
          <MoreVertIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={run(onDisplay)}>
          <ListItemIcon><TuneIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Anzeige…" secondary={canEditDisplay ? 'Wechsel, Wertungen, Laufband' : 'nur ansehen'} />
        </MenuItem>
        <MenuItem component="a" href="/public/highscore" target="_blank" rel="noopener noreferrer" onClick={close}>
          <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Öffentliche Anzeige öffnen" />
        </MenuItem>
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
