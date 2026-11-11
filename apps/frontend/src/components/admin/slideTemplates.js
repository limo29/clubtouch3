// Vorlagen für Werbefolien (1920×1080). Schwarzer Grund, wenig Leuchtfläche: es ist ein Club, kein Büro.
// Jede Vorlage liefert { bgColor, elements } wie der Editor sie speichert; Texte sind Platzhalter zum Überschreiben.

import { DISPLAY_COLORS } from '../display/StageChrome';

// Dieselben Farben wie der Clubscore-Bildschirm daneben (eine Quelle: StageChrome.js)
export const SLIDE_COLORS = DISPLAY_COLORS;
const C = SLIDE_COLORS;
export const LOGO_SRC = '/assets/images/Logo.png'; // dasselbe Logo wie der Knopf „Logo“ im Editor

let seq = 0;
const el = (type, props) => ({ id: `tpl-${Date.now()}-${seq++}`, type, rotation: 0, color: C.white, ...props });
// Ebenen nach der Reihenfolge in der Liste (später = weiter vorne). Nicht aus dem Zähler `seq` ableiten:
// der läuft über alle Vorschaubilder des Vorlagen-Dialogs weiter und überholte sonst jede feste Ebene.
const slide = (elements, bgColor = C.black) => ({ bgColor, elements: elements.map((e, i) => ({ ...e, zIndex: i + 1 })) });
const text = (content, x, y, width, height, fontSize, extra = {}) => el('text', {
    content, x, y, width, height, fontSize, fontFamily: 'Inter', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left', ...extra,
});
const line = (x, y, width, color = C.green) => el('line', { x, y, width, height: 20, content: '', color });
const logo = (x = 1620, y = 60, size = 220) => el('image', { x, y, width: size, height: size, content: LOGO_SRC });

export const SLIDE_TEMPLATES = [
    {
        id: 'karte',
        name: 'Getränkekarte',
        hint: 'Eine Kategorie in zwei Spalten. Sorten gruppieren und ausblenden geht in den Einstellungen der Karte.',
        build: ({ category = 'Bier' } = {}) => slide([
            text(category.toUpperCase(), 110, 70, 1300, 190, 190, { fontFamily: 'Bebas Neue', fontWeight: 'normal' }),
            line(110, 262, 420),
            el('menu', { x: 110, y: 320, width: 1700, height: 700, content: category, fontSize: 118, fontFamily: 'Inter', columns: 2, priceColor: C.green, hidden: [], groups: [] }),
            logo(1620, 50, 210),
        ]),
    },
    {
        id: 'karte-doppelt',
        name: 'Karte mit zwei Kategorien',
        hint: 'Links und rechts je eine Kategorie, z. B. Bier und Alkoholfrei.',
        build: ({ category = 'Bier', category2 = 'Alkoholfrei' } = {}) => slide([
            text(category.toUpperCase(), 110, 70, 800, 150, 140, { fontFamily: 'Bebas Neue', fontWeight: 'normal' }),
            line(110, 222, 300),
            el('menu', { x: 110, y: 270, width: 800, height: 760, content: category, fontSize: 105, fontFamily: 'Inter', columns: 1, priceColor: C.green, hidden: [], groups: [] }),
            text(category2.toUpperCase(), 1010, 70, 800, 150, 140, { fontFamily: 'Bebas Neue', fontWeight: 'normal' }),
            line(1010, 222, 300),
            el('menu', { x: 1010, y: 270, width: 800, height: 760, content: category2, fontSize: 105, fontFamily: 'Inter', columns: 1, priceColor: C.green, hidden: [], groups: [] }),
        ]),
    },
    {
        id: 'ankuendigung',
        name: 'Ankündigung',
        hint: 'Termin oder Veranstaltung: Datum, Titel, eine Zeile dazu.',
        build: () => slide([
            text('SA · 14. DEZEMBER · 20 UHR', 130, 240, 1500, 90, 64, { fontFamily: 'Oswald', color: C.green }),
            text('WEIHNACHTSFEIER', 130, 340, 1660, 300, 290, { fontFamily: 'Bebas Neue', fontWeight: 'normal' }),
            line(130, 660, 520, C.red),
            text('Glühwein, Musik und Wichteln im Clubraum', 130, 720, 1500, 90, 58, { fontWeight: 'normal', color: C.dim }),
            logo(1600, 60, 230),
        ]),
    },
    {
        id: 'angebot',
        name: 'Angebot des Abends',
        hint: 'Ein Getränk groß mit Preis.',
        build: () => slide([
            text('HEUTE', 130, 170, 600, 110, 84, { fontFamily: 'Oswald', color: C.amber }),
            text('Aperol Spritz', 130, 330, 1150, 240, 150, { fontFamily: 'Permanent Marker', fontWeight: 'normal' }),
            text('frisch gemixt, solange der Vorrat reicht', 130, 610, 1150, 80, 50, { fontWeight: 'normal', color: C.dim }),
            // dunkle Scheibe statt einer hellgrünen Fläche, der Preis leuchtet selbst
            el('circle', { x: 1330, y: 300, width: 460, height: 460, content: '', borderRadius: '50%', color: C.greenDeep }),
            text('2,50 €', 1330, 410, 460, 240, 190, { fontFamily: 'Bebas Neue', fontWeight: 'normal', color: C.green, textAlign: 'center' }),
            logo(130, 800, 200),
        ]),
    },
    {
        id: 'zeiten',
        name: 'Öffnungszeiten',
        hint: 'Wochentage links, Zeiten rechts.',
        build: () => slide([
            text('GEÖFFNET', 130, 90, 1200, 190, 190, { fontFamily: 'Bebas Neue', fontWeight: 'normal' }),
            line(130, 282, 420),
            text('Freitag\nSamstag\nvor Feiertagen', 130, 360, 800, 420, 92, { fontWeight: 'normal' }),
            text('ab 19 Uhr\nab 19 Uhr\nab 20 Uhr', 950, 360, 700, 420, 92, { color: C.green }),
            text('Der Clubraum ist für alle Mitglieder und ihre Gäste da.', 130, 860, 1500, 80, 50, { fontWeight: 'normal', color: C.dim }),
            logo(1600, 60, 230),
        ]),
    },
    {
        id: 'neon',
        name: 'Leuchtschrift',
        hint: 'Ein kurzer Spruch als Neonschrift.',
        build: () => slide([
            text('PROST', 110, 300, 1700, 360, 330, { fontFamily: 'Monoton', fontWeight: 'normal', color: C.red, textAlign: 'center' }),
            text('schön, dass du da bist', 110, 700, 1700, 110, 80, { fontFamily: 'Permanent Marker', fontWeight: 'normal', color: C.green, textAlign: 'center' }),
        ]),
    },
    {
        id: 'leer',
        name: 'Leer',
        hint: 'Schwarze Fläche mit Logo.',
        build: () => slide([logo(60, 800, 220)]),
    },
];
