import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import api from '../../services/api';
import { money } from '../../utils/format';
import { dateDE, displayName, scoreText } from './format';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Frühere Jahreswertungen (manuelle Resets und automatischer Jahreswechsel). */
export default function ArchiveDialog({ open, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { data, isLoading, error } = useQuery({
    queryKey: ['clubscore-archive'],
    queryFn: async () => (await api.get('/highscore/archive')).data?.archive || [],
    enabled: open,
    staleTime: 60000,
  });
  const archive = data || [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Archiv – frühere Jahreswertungen</DialogTitle>
      <DialogContent dividers>
        {isLoading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>}
        {error && <Alert severity="error">{error.response?.data?.error || 'Archiv konnte nicht geladen werden.'}</Alert>}
        {!isLoading && !error && archive.length === 0 && (
          <Typography color="text.secondary">Noch keine archivierten Jahreswertungen.</Typography>
        )}
        <Stack divider={<Divider flexItem />} spacing={2}>
          {archive.map((a) => {
            const top = (a.amount?.entries || []).slice(0, 3);
            const countWinner = a.count?.entries?.[0];
            const teamWinner = a.teams?.amount?.entries?.[0];
            return (
              <Box key={a.id}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 1.5 }} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={800}>{dateDE(a.periodStart)} – {dateDE(a.periodEnd)}</Typography>
                  <Chip size="small" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} label={a.auto ? 'automatisch archiviert' : 'manuell zurückgesetzt'} />
                  <Typography variant="caption" color="text.secondary">
                    {a.auto ? '' : `am ${dateDE(a.resetAt)}${a.resetBy ? ` von ${a.resetBy}` : ''} · `}
                    {a.entriesCount ?? (a.amount?.entries || []).length} Teilnehmer
                  </Typography>
                </Stack>
                {top.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">Keine Einträge in dieser Wertung.</Typography>
                ) : (
                  <Stack spacing={0.5}>
                    {top.map((e, i) => (
                      <Typography key={e.customerId || i} variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {MEDALS[i]} <strong>{displayName(e)}</strong> · {money(e.score)}
                      </Typography>
                    ))}
                    {countWinner && (
                      <Typography variant="body2" color="text.secondary">
                        Meiste Artikel: {displayName(countWinner)} ({scoreText('COUNT', countWinner.score)})
                      </Typography>
                    )}
                    {teamWinner && (
                      <Typography variant="body2" color="text.secondary">
                        Bestes Team: {teamWinner.name} ({money(teamWinner.total)})
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}
