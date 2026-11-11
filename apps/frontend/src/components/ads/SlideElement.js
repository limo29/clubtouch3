import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import FavoriteIcon from '@mui/icons-material/Favorite';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import api from '../../services/api';

export const ICONS = [
    { name: 'star', icon: <StarIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'heart', icon: <FavoriteIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'warning', icon: <WarningIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'check', icon: <CheckCircleIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'arrow', icon: <ArrowForwardIcon sx={{ width: '100%', height: '100%' }} /> },
];

const priceDE = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

/**
 * Zeilen der Getränkekarte aus den Artikeln einer Kategorie:
 *  - `hidden` (Artikel-IDs) werden weggelassen
 *  - `groups` ([{ id, label, articleIds }]) fassen mehrere Artikel zu einer Zeile zusammen (z. B. alle Frucade-Sorten);
 *    die Zeile steht dort, wo der erste Artikel der Gruppe stünde. Gleicher Preis → dieser Preis, sonst „ab …“.
 *    Die Sorten stehen klein darunter, ohne das wiederholte Gruppenwort („Frucade ACE“ → „ACE“).
 */
export function buildMenuRows(articles, { hidden = [], groups = [] } = {}) {
    const hiddenSet = new Set(hidden);
    const groupOf = new Map();
    groups.forEach((g) => (g.articleIds || []).forEach((id) => { if (!groupOf.has(id)) groupOf.set(id, g); }));
    const done = new Set();
    const rows = [];
    for (const a of articles) {
        if (hiddenSet.has(a.id)) continue;
        const g = groupOf.get(a.id);
        if (!g) { rows.push({ key: a.id, name: a.name, price: priceDE(a.price) }); continue; }
        if (done.has(g.id)) continue;
        done.add(g.id);
        const members = articles.filter((x) => groupOf.get(x.id) === g && !hiddenSet.has(x.id));
        const prices = members.map((x) => Number(x.price));
        const min = Math.min(...prices);
        const label = (g.label || '').trim() || members[0].name;
        const strip = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
        rows.push({
            key: `g-${g.id}`,
            name: label,
            price: prices.every((x) => x === min) ? priceDE(min) : `ab ${priceDE(min)}`,
            sub: members.map((x) => x.name.replace(strip, '')).join(' · '),
        });
    }
    return rows;
}

const MenuRenderer = ({ element, style, isEditor }) => {
    const [articles, setArticles] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const categoryName = element.content;
    const color = element.color || '#ffffff';
    // Zeilengröße wie bisher aus der Elementgröße abgeleitet, damit bestehende Folien gleich aussehen
    const rowSize = (element.fontSize || 40) * 0.4;
    const columns = Number(element.columns) === 2 ? 2 : 1;

    useEffect(() => {
        let cancelled = false;
        // Öffentlicher Endpoint: funktioniert auch auf dem Display ohne Login
        api.get('/public/articles', { params: { category: categoryName } })
            .then((res) => { if (!cancelled) setArticles(res.data?.articles || []); })
            .catch((err) => console.error('Getränkekarte konnte nicht geladen werden', err))
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, [categoryName, isEditor]);

    const rows = buildMenuRows(articles, { hidden: element.hidden, groups: element.groups });

    if (!rows.length) {
        if (!isEditor) return null; // auf dem Bildschirm lieber nichts als ein Platzhalter
        return (
            <Box style={{ ...style, border: '1px dashed grey', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography style={{ fontSize: rowSize, color }}>{loaded ? `Keine Artikel in „${categoryName}“` : 'Lädt …'}</Typography>
            </Box>
        );
    }

    return (
        <Box style={{ ...style, display: 'block', overflow: 'hidden', textAlign: 'left', whiteSpace: 'normal' }}
            sx={{ columnCount: columns, columnGap: `${rowSize * 1.6}px` }}>
            {rows.map((row) => (
                <Box key={row.key} sx={{ breakInside: 'avoid', pb: `${rowSize * 0.28}px`, mb: `${rowSize * 0.28}px`, borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: `${rowSize * 0.6}px` }}>
                        <Box component="span" sx={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: `${rowSize}px`, lineHeight: 1.2, color }}>{row.name}</Box>
                        <Box component="span" sx={{ fontWeight: 700, fontSize: `${rowSize}px`, lineHeight: 1.2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: element.priceColor || color }}>{row.price}</Box>
                    </Box>
                    {row.sub && (
                        <Box sx={{ fontSize: `${rowSize * 0.58}px`, lineHeight: 1.25, mt: `${rowSize * 0.08}px`, color, opacity: 0.62 }}>{row.sub}</Box>
                    )}
                </Box>
            ))}
        </Box>
    );
};

// Die gewählte Schrift ist nicht auf jedem Bildschirm installiert (Roboto fehlt z. B. auf vielen Linux-Geräten).
// Ohne Rückfallkette würde der Browser dann eine Serifenschrift nehmen und die Folie sähe überall anders aus.
const SERIF = ['Times New Roman', 'Georgia'];
const MONO = ['Courier New'];
export const fontStack = (name) => {
    if (!name) return '"Inter", "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (SERIF.includes(name)) return `"${name}", Georgia, "Times New Roman", serif`;
    if (MONO.includes(name)) return `"${name}", "Courier New", monospace`;
    if (name === 'Impact') return 'Impact, "Arial Narrow Bold", "Helvetica Neue", Arial, sans-serif';
    return `"${name}", "Inter", "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif`;
};

export default function SlideElement({ element, isEditor = false }) {
    const style = {
        width: '100%',
        height: '100%',
        transform: `rotate(${element.rotation}deg)`,
        display: 'flex',
        alignItems: 'center',
        // Ausrichtung aus dem Editor (links/zentriert/rechts) auch für einzeilige Texte wirksam machen
        justifyContent: element.type === 'text' ? ({ left: 'flex-start', right: 'flex-end' }[element.textAlign] || 'center') : 'center',
        textAlign: element.textAlign || 'center',
        color: element.color,
        fontSize: element.type === 'text' ? `${element.fontSize}px` : undefined,
        fontFamily: fontStack(element.fontFamily),
        fontWeight: element.fontWeight,
        fontStyle: element.fontStyle,
        backgroundColor: element.type === 'rect' || element.type === 'circle' ? element.color : 'transparent',
        borderRadius: element.borderRadius || 0,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
    };

    if (element.type === 'image') return <img src={element.content} alt="" style={{ ...style, objectFit: 'contain' }} />;

    if (element.type === 'icon') {
        const iconDef = ICONS.find(i => i.name === element.content);
        return <div style={style}>{iconDef ? iconDef.icon : <StarIcon />}</div>;
    }

    if (element.type === 'line') {
        return (
            <div style={{ ...style, display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '100%', height: 6, backgroundColor: element.color, borderRadius: 3 }}></div>
            </div>
        );
    }

    if (element.type === 'menu') {
        return <MenuRenderer element={element} style={style} isEditor={isEditor} />;
    }

    return <div style={style}>{element.content}</div>;
}
