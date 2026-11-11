const prisma = require('../utils/prisma');
const { userError } = require('../utils/httpError');

// Welcher Bildschirm zeigt was. Jeder Monitor öffnet fest /screen/<Nummer>; hier steht, was dort läuft.
// So lässt sich nach einem Monitor- oder Kabeltausch die Belegung in der App umstellen, ohne am PC etwas zu ändern.
const KEY = 'screens.assignment';
const MAX_SCREENS = 6;
const CONTENTS = ['highscore', 'ads', 'sales', 'none'];
const DEFAULT = { 1: 'highscore', 2: 'ads', 3: 'sales' };

function normalize(input) {
  const out = {};
  for (let n = 1; n <= MAX_SCREENS; n++) {
    const v = input?.[n] ?? input?.[String(n)];
    if (v === undefined || v === null || v === '') continue;
    if (!CONTENTS.includes(v)) throw userError(`Bildschirm ${n}: unbekannter Inhalt „${v}“`, 400);
    if (v !== 'none') out[n] = v;
  }
  return out;
}

async function getAssignment() {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (!row) return { ...DEFAULT };
  try { return normalize(JSON.parse(row.value)); } catch { return { ...DEFAULT }; }
}

async function setAssignment(input) {
  const value = JSON.stringify(normalize(input));
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value, description: 'Belegung der Bildschirme (/screen/<Nummer>)' },
  });
  return JSON.parse(value);
}

module.exports = { getAssignment, setAssignment, MAX_SCREENS, CONTENTS };
