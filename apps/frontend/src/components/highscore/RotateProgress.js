import React from 'react';
import { Box, keyframes } from '@mui/material';

const grow = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`;

/** Dünner Balken bis zum nächsten Ansichtswechsel; cycle als Key startet ihn neu. */
export default function RotateProgress({ active, cycle, seconds, height = 3 }) {
  return (
    <Box aria-hidden sx={{ height, flexShrink: 0, bgcolor: active ? 'action.hover' : 'transparent', overflow: 'hidden' }}>
      {active && (
        <Box key={cycle} sx={{
          height: '100%', bgcolor: 'primary.main', transformOrigin: 'left',
          animation: `${grow} ${seconds}s linear both`,
        }} />
      )}
    </Box>
  );
}
