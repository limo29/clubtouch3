import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// Untergrenze beim Einpassen: kleiner als 40 % der eingestellten Größe (mindestens 16 px) wird es nicht,
// darunter ist die Karte aus ein paar Metern nicht mehr lesbar; dann wird lieber unten abgeschnitten.
const MENU_MIN_FACTOR = 0.4;
const MENU_MIN_PX = 16;

const MenuRenderer = ({ element, style, isEditor }) => {
    const [articles, setArticles] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const categoryName = element.content;
    const color = element.color || '#ffffff';
    // Zeilengröße wie bisher aus der Elementgröße abgeleitet, damit bestehende Folien gleich aussehen
    const baseSize = (element.fontSize || 40) * 0.4;
    const columns = Number(element.columns) === 2 ? 2 : 1;
    const boxRef = useRef(null);
    const listRef = useRef(null);
    const [rowSize, setRowSize] = useState(baseSize);

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
    const rowsKey = rows.map((r) => `${r.key}:${r.name}:${r.price}:${r.sub || ''}`).join('|');

    // Nie überlaufen: passt die Liste nicht in die Höhe des Elements, wird die Zeilengröße so weit verkleinert,
    // bis alles passt. Gemessen wird ohne Skalierung (offsetHeight ignoriert transform), daher ergeben
    // Editor und Bildschirm dieselbe Größe. Alle Maße hängen an --rs und lassen sich so direkt am DOM ausprobieren.
    useLayoutEffect(() => {
        const box = boxRef.current;
        const list = listRef.current;
        if (!box || !list) return undefined;
        let cancelled = false;
        const fit = () => {
            if (cancelled) return;
            const avail = box.clientHeight;
            if (!(avail > 0)) return;
            const min = Math.min(baseSize, Math.max(MENU_MIN_PX, baseSize * MENU_MIN_FACTOR));
            let size = baseSize;
            for (let i = 0; i < 8; i += 1) {
                list.style.setProperty('--rs', `${size}px`);
                const h = list.offsetHeight;
                if (h <= avail || size <= min) break;
                size = Math.max(min, size * (avail / h) * 0.99);
            }
            list.style.setProperty('--rs', `${size}px`);
            setRowSize(size);
        };
        fit();
        // Schriften laden asynchron nach; danach stimmt die Höhe erst wirklich
        document.fonts?.ready?.then(fit);
        let ro;
        if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(fit); ro.observe(box); }
        return () => { cancelled = true; ro?.disconnect(); };
    }, [rowsKey, baseSize, columns, element.fontFamily]);

    if (!rows.length) {
        if (!isEditor) return null; // auf dem Bildschirm lieber nichts als ein Platzhalter
        return (
            <Box style={{ ...style, border: '1px dashed grey', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography style={{ fontSize: baseSize, color }}>{loaded ? `Keine Artikel in „${categoryName}“` : 'Lädt …'}</Typography>
            </Box>
        );
    }

    return (
        <Box ref={boxRef} style={{ ...style, display: 'block', overflow: 'hidden', textAlign: 'left', whiteSpace: 'normal' }}>
            <Box ref={listRef} style={{ '--rs': `${rowSize}px` }}
                sx={{ columnCount: columns, columnGap: 'calc(var(--rs) * 1.6)' }}>
                {rows.map((row) => (
                    <Box key={row.key} sx={{ breakInside: 'avoid', pb: 'calc(var(--rs) * 0.28)', mb: 'calc(var(--rs) * 0.28)', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 'calc(var(--rs) * 0.6)' }}>
                            <Box component="span" sx={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 'var(--rs)', lineHeight: 1.2, color }}>{row.name}</Box>
                            <Box component="span" sx={{ fontWeight: 700, fontSize: 'var(--rs)', lineHeight: 1.2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: element.priceColor || color }}>{row.price}</Box>
                        </Box>
                        {row.sub && (
                            <Box sx={{ fontSize: 'calc(var(--rs) * 0.58)', lineHeight: 1.25, mt: 'calc(var(--rs) * 0.08)', color, opacity: 0.62 }}>{row.sub}</Box>
                        )}
                    </Box>
                ))}
            </Box>
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
