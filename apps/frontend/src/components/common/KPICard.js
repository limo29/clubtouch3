import React from 'react';
import { Card, Box, Typography, Skeleton, alpha, useTheme } from '@mui/material';

/**
 * @param {string} title - The title of the card
 * @param {string|number} value - The main value to display
 * @param {React.ElementType} icon - The icon component to display
 * @param {string} color - The color theme key (primary, success, error, warning, info)
 * @param {boolean} loading - Whether the data is loading
 * @param {string} subTitle - Optional subtitle or secondary text
 * @param {Function} onClick - Optional click handler
 */
export default function KPICard({
    title,
    value,
    icon: Icon,
    color = 'primary',
    loading = false,
    subTitle,
    onClick,
    children,
    sx = {}
}) {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';

    // Resolve the main color from the theme
    const themeColor = theme.palette[color];
    const mainColor = themeColor?.main || (isValidColor(color) ? color : theme.palette.text.primary);
    const darkColor = themeColor?.dark || mainColor;
    const lightColor = themeColor?.light || mainColor;

    function isValidColor(str) {
        if (!str) return false;
        if (str === 'default') return false;
        return str.startsWith('#') || str.startsWith('rgb') || str.startsWith('hsl');
    }

    return (
        <Card
            elevation={0}
            onClick={onClick}
            sx={{
                position: 'relative',
                overflow: 'hidden',
                height: '100%',
                minHeight: 140,
                borderRadius: 4,
                // Dark Mode: Subtle translucent background with border
                // Light Mode: Vibrant solid gradient
                background: isDark
                    ? `linear-gradient(135deg, ${alpha(mainColor, 0.15)} 0%, ${alpha(mainColor, 0.05)} 100%)`
                    : `linear-gradient(135deg, ${mainColor} 0%, ${darkColor} 100%)`,
                border: isDark ? `1px solid ${alpha(mainColor, 0.3)}` : 'none',
                color: isDark ? lightColor : 'white',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': onClick ? {
                    transform: 'translateY(-4px)',
                    boxShadow: isDark
                        ? `0 12px 24px -10px ${alpha(mainColor, 0.2)}`
                        : `0 12px 24px -10px ${alpha(mainColor, 0.5)}`
                } : {},
                ...sx
            }}
        >
            {/* Background Icon Decoration */}
            {Icon && (
                <Box
                    sx={{
                        position: 'absolute',
                        right: -20,
                        top: -20,
                        opacity: isDark ? 0.1 : 0.15,
                        transform: 'rotate(15deg)',
                        zIndex: 0,
                        pointerEvents: 'none',
                        color: isDark ? mainColor : 'white',
                    }}
                >
                    <Icon sx={{ fontSize: 160 }} />
                </Box>
            )}

            {/* Content */}
            <Box
                sx={{
                    position: 'relative',
                    zIndex: 1,
                    p: 3,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                }}
            >
                <Box>
                    <Typography
                        variant="subtitle2"
                        sx={{
                            textTransform: 'uppercase',
                            letterSpacing: '1.5px',
                            fontWeight: 700,
                            opacity: 0.9,
                            mb: 1
                        }}
                    >
                        {title}
                    </Typography>

                    {loading ? (
                        <Skeleton variant="text" width="60%" height={60} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : (
                        <Typography
                            variant="h3"
                            sx={{
                                fontWeight: 800,
                                textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                lineHeight: 1
                            }}
                        >
                            {value}
                        </Typography>
                    )}
                </Box>

                {subTitle && (
                    <Typography
                        variant="body2"
                        sx={{
                            mt: 2,
                            opacity: 0.9,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5
                        }}
                    >
                        {subTitle}
                    </Typography>
                )}

                {children}
            </Box>
        </Card>
    );
}
