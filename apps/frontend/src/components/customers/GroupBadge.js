import React from 'react';
import { Avatar, Tooltip } from '@mui/material';

/**
 * Abzeichen einer Kundengruppe (Team): Bild → Emoji → farbiger Kreis mit Anfangsbuchstaben.
 * group: { name, color, emoji, imageUrl } | null  ·  size: Kantenlänge in px
 */
export default function GroupBadge({ group, size = 24, sx, tooltip = true }) {
  if (!group) return null;
  const color = group.color || '#1976d2';
  const base = {
    width: size,
    height: size,
    fontSize: Math.round(size * (group.emoji ? 0.62 : 0.5)),
    fontWeight: 800,
    flexShrink: 0,
    ...sx,
  };

  let avatar;
  if (group.imageUrl) {
    avatar = <Avatar src={group.imageUrl} alt={group.name} sx={{ ...base, border: `2px solid ${color}` }} />;
  } else if (group.emoji) {
    avatar = (
      <Avatar alt={group.name} sx={{ ...base, bgcolor: 'transparent', border: `2px solid ${color}`, lineHeight: 1 }}>
        <span role="img" aria-label={group.name}>{group.emoji}</span>
      </Avatar>
    );
  } else {
    avatar = (
      <Avatar alt={group.name} sx={{ ...base, bgcolor: color, color: '#fff' }}>
        {(group.name || '?').trim().charAt(0).toUpperCase()}
      </Avatar>
    );
  }

  return tooltip ? <Tooltip title={group.name}>{avatar}</Tooltip> : avatar;
}
