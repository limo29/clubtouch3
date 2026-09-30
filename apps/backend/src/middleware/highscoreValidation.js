// Validierungsketten für den Clubscore (Ziele, Zielvorlagen, Anzeige-Einstellung).
const { body } = require('express-validator');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { handleValidationErrors } = require('./validation');

const GOAL_KINDS = ['ARTICLE', 'CATEGORY', 'REVENUE'];
const MAX_GOALS = 6;
const MAX_TEMPLATES = 20;
const VIEWS = ['amount', 'count', 'teams'];

/** Altes Format ({ articleId, targetUnits }) auf das neue Modell heben. */
function liftGoal(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
  const out = { ...g };
  if (out.target === undefined && out.targetUnits !== undefined) out.target = out.targetUnits;
  if (!out.kind && out.articleId) out.kind = 'ARTICLE';
  if (out.groupId === '') out.groupId = null;
  return out;
}

const liftGoals = (arr) => (Array.isArray(arr) ? arr.map(liftGoal) : arr);

/** Formale Prüfung eines Ziels; wirft mit deutscher Meldung. */
function checkGoalShape(g, prefix) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error(`${prefix}: ungültiges Format`);
  if (!GOAL_KINDS.includes(g.kind)) throw new Error(`${prefix}: Zieltyp muss ARTICLE, CATEGORY oder REVENUE sein`);
  const target = Number(g.target);
  if (g.target === null || g.target === '' || !Number.isFinite(target) || target <= 0) {
    throw new Error(`${prefix}: Zielwert muss größer als 0 sein`);
  }
  if (target > 1000000) throw new Error(`${prefix}: Zielwert ist zu groß`);
  if (g.kind !== 'REVENUE' && !Number.isInteger(target)) {
    throw new Error(`${prefix}: Stückzahl muss eine ganze Zahl sein`);
  }
  if (g.kind === 'ARTICLE' && (typeof g.articleId !== 'string' || !g.articleId.trim())) {
    throw new Error(`${prefix}: Artikel fehlt`);
  }
  if (g.kind === 'CATEGORY' && (typeof g.category !== 'string' || !g.category.trim())) {
    throw new Error(`${prefix}: Kategorie fehlt`);
  }
  if (g.groupId !== undefined && g.groupId !== null && typeof g.groupId !== 'string') {
    throw new Error(`${prefix}: ungültige Gruppe`);
  }
  if (g.label !== undefined && g.label !== null && (typeof g.label !== 'string' || g.label.length > 60)) {
    throw new Error(`${prefix}: Bezeichnung darf höchstens 60 Zeichen lang sein`);
  }
  if (g.id !== undefined && g.id !== null && (typeof g.id !== 'string' || g.id.length > 64)) {
    throw new Error(`${prefix}: ungültige Ziel-ID`);
  }
}

const goalKey = (g) => [g.kind, g.articleId || '', String(g.category || '').trim().toLowerCase(), g.groupId || ''].join('|');

const validateGoals = [
  body('goals')
    .isArray({ max: MAX_GOALS })
    .withMessage(`Ziele müssen eine Liste mit höchstens ${MAX_GOALS} Einträgen sein`)
    .bail()
    .customSanitizer(liftGoals)
    .custom(async (goals) => {
      goals.forEach((g, i) => checkGoalShape(g, `Ziel ${i + 1}`));

      const seen = new Set();
      goals.forEach((g, i) => {
        const key = goalKey(g);
        if (seen.has(key)) throw new Error(`Ziel ${i + 1}: dieses Ziel ist doppelt`);
        seen.add(key);
      });

      // Referenzen prüfen
      const articleIds = [...new Set(goals.filter((g) => g.kind === 'ARTICLE').map((g) => g.articleId))];
      if (articleIds.length) {
        const found = await prisma.article.findMany({ where: { id: { in: articleIds } }, select: { id: true } });
        const ok = new Set(found.map((a) => a.id));
        const i = goals.findIndex((g) => g.kind === 'ARTICLE' && !ok.has(g.articleId));
        if (i >= 0) throw new Error(`Ziel ${i + 1}: Artikel nicht gefunden`);
      }
      for (const [i, g] of goals.entries()) {
        if (g.kind !== 'CATEGORY') continue;
        const hit = await prisma.article.findFirst({
          where: { category: { equals: g.category.trim(), mode: 'insensitive' } },
          select: { id: true },
        });
        if (!hit) throw new Error(`Ziel ${i + 1}: Kategorie „${g.category}“ gibt es nicht`);
      }
      const groupIds = [...new Set(goals.filter((g) => g.groupId).map((g) => g.groupId))];
      if (groupIds.length) {
        let ok = new Set();
        try {
          const rows = await prisma.$queryRaw`SELECT id FROM "CustomerGroup" WHERE id IN (${Prisma.join(groupIds)})`;
          ok = new Set(rows.map((r) => r.id));
        } catch {
          // Tabelle (noch) nicht vorhanden → keine Gruppe gültig
        }
        const i = goals.findIndex((g) => g.groupId && !ok.has(g.groupId));
        if (i >= 0) throw new Error(`Ziel ${i + 1}: Gruppe nicht gefunden`);
      }
      return true;
    }),
  body('movingTargets').optional().isBoolean().withMessage('movingTargets muss true oder false sein').toBoolean(),
  handleValidationErrors,
];

const validateGoalTemplates = [
  body('templates')
    .isArray({ max: MAX_TEMPLATES })
    .withMessage(`Vorlagen müssen eine Liste mit höchstens ${MAX_TEMPLATES} Einträgen sein`)
    .bail()
    .customSanitizer((arr) => arr.map((t) => (t && typeof t === 'object' ? { ...t, goals: liftGoals(t.goals) } : t)))
    .custom((templates) => {
      const names = new Set();
      templates.forEach((t, i) => {
        const prefix = `Vorlage ${i + 1}`;
        if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error(`${prefix}: ungültiges Format`);
        const name = typeof t.name === 'string' ? t.name.trim() : '';
        if (!name) throw new Error(`${prefix}: Name ist erforderlich`);
        if (name.length > 60) throw new Error(`${prefix}: Name darf höchstens 60 Zeichen lang sein`);
        if (names.has(name.toLowerCase())) throw new Error(`${prefix}: Name „${name}“ ist doppelt`);
        names.add(name.toLowerCase());
        if (!Array.isArray(t.goals) || t.goals.length > MAX_GOALS) {
          throw new Error(`${prefix}: höchstens ${MAX_GOALS} Ziele`);
        }
        t.goals.forEach((g, j) => checkGoalShape(g, `${prefix}, Ziel ${j + 1}`));
        if (t.movingTargets !== undefined && typeof t.movingTargets !== 'boolean') {
          throw new Error(`${prefix}: movingTargets muss true oder false sein`);
        }
      });
      return true;
    }),
  handleValidationErrors,
];

const validateDisplay = [
  body('view').optional().isIn([...VIEWS, 'rotate']).withMessage('Ansicht muss amount, count, teams oder rotate sein'),
  body('rotateViews')
    .optional()
    .isArray({ min: 1, max: VIEWS.length })
    .withMessage('Mindestens eine Ansicht für den Wechsel auswählen')
    .bail()
    .custom((views) => {
      if (!views.every((v) => VIEWS.includes(v))) throw new Error('Wechsel-Ansichten: nur amount, count, teams erlaubt');
      if (new Set(views).size !== views.length) throw new Error('Wechsel-Ansichten: keine doppelten Einträge');
      return true;
    }),
  body('rotateSeconds').optional().isInt({ min: 5, max: 120 }).withMessage('Wechseldauer muss zwischen 5 und 120 Sekunden liegen').toInt(),
  body('board').optional().isIn(['both', 'day', 'year']).withMessage('Board muss both, day oder year sein'),
  body('ticker').optional().isBoolean({ strict: true }).withMessage('ticker muss true oder false sein').toBoolean(),
  handleValidationErrors,
];

module.exports = {
  validateGoals,
  validateGoalTemplates,
  validateDisplay,
};
