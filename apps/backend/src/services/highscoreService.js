const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { emitHighscoreUpdate } = require('../utils/websocket');
const { BUSINESS_DAY_START_HOUR, businessDayWindow, businessDayLabel } = require('../utils/businessDay');

// Die vier Boards (Tag/Jahr x Umsatz/Anzahl) werden einmal berechnet und kurz gecacht:
// Public-Display, Clubscore-Seite und jeder Verkauf fragten sonst je vier Full-Scans an.
const BOARD_CACHE_TTL_MS = 5000;

class HighscoreService {
  constructor() {
    this._boardsCache = { at: 0, data: null, promise: null };
  }

  async getSettings() {
    // Kannst du später aus DB/ENV laden
    const lastReset = await this._getLastYearlyReset();
    return {
      dailyResetHour: BUSINESS_DAY_START_HOUR, // derselbe Geschäftstag wie Tagesabschluss/Dashboard
      displayCount: 20,            // Top 20
      countInactiveArticles: false,
      scoreMode: 'AMOUNT',
      yearlyStart: this._yearlyStartFrom(lastReset),
      lastYearlyReset: lastReset ? { at: lastReset.createdAt, byUserId: lastReset.userId } : null,
    };
  }

  /** Letzter manueller Jahres-Reset (AuditLog-Marke, kein eigenes Schema). */
  async _getLastYearlyReset() {
    return prisma.auditLog.findFirst({
      where: { entityType: 'Highscore', action: 'RESET_YEARLY_HIGHSCORE' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, userId: true },
    });
  }

  /**
   * Start der Jahreswertung: Kalenderjahresanfang, es sei denn, es gab in diesem
   * Kalenderjahr einen manuellen Reset – dann zählt ab dem Reset-Zeitpunkt.
   * (Vorher wurde der Reset nur archiviert und die Wertung lief unverändert weiter.)
   */
  _yearlyStartFrom(lastReset) {
    const jan1 = new Date(new Date().getFullYear(), 0, 1);
    if (lastReset && lastReset.createdAt > jan1) return lastReset.createdAt;
    return jan1;
  }

  async _getPeriodStart(type, resetHour = BUSINESS_DAY_START_HOUR) {
    if (type === 'YEARLY') {
      return this._yearlyStartFrom(await this._getLastYearlyReset());
    }
    return businessDayWindow(new Date(), resetHour).start;
  }

  _getDailyWindow(resetHour = BUSINESS_DAY_START_HOUR) {
    // liefert [start, end) für "heute" im Geschäftstag-Fenster
    const { start } = businessDayWindow(new Date(), resetHour);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  async _getCountingArticleIds(includeInactive) {
    const articles = await prisma.article.findMany({
      where: { countsForHighscore: true, ...(includeInactive ? {} : { active: true }) },
      select: { id: true },
    });
    return articles.map(a => a.id);
  }

  // Hinweis: "createdAt" ist timestamp ohne Zeitzone (Prisma speichert UTC). Ein JS-Date-Parameter
  // kommt als timestamptz an; ohne "AT TIME ZONE 'UTC'" würde Postgres die Spalte in der
  // Session-Zeitzone interpretieren und das Fenster um den UTC-Offset verschieben.
  /** Einmal pro Board-Satz: Settings (inkl. Reset-Marke), zaehlende Artikel, Periodenstarts. */
  async _buildContext() {
    const settings = await this.getSettings();
    const articleIds = await this._getCountingArticleIds(settings.countInactiveArticles);
    return {
      settings,
      articleIds,
      starts: {
        DAILY: businessDayWindow(new Date(), settings.dailyResetHour).start,
        YEARLY: settings.yearlyStart,
      },
    };
  }

  async calculateHighscore(type = 'DAILY', mode = 'AMOUNT', ctx = null) {
    const c = ctx || await this._buildContext();
    const settings = c.settings;
    const startDate = c.starts[type];
    const articleIds = c.articleIds;

    if (!articleIds.length) {
      return { type, mode, startDate, entries: [], lastUpdated: new Date() };
    }

    const scoreExpr =
      mode === 'AMOUNT'
        ? Prisma.sql`SUM(ti."totalPrice")::decimal`
        : Prisma.sql`SUM(ti.quantity)::int`;

    const extraExpr =
      mode === 'AMOUNT'
        ? Prisma.sql`SUM(ti.quantity)::int AS total_items`
        : Prisma.sql`SUM(ti."totalPrice")::decimal AS total_amount`;

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          c.id                      AS customer_id,
          c.name                    AS customer_name,
          c.nickname                AS customer_nickname,
          ${scoreExpr}              AS score,
          COUNT(DISTINCT t.id)      AS transaction_count,
          ${extraExpr}
        FROM "Customer" c
        JOIN "Transaction" t   ON t."customerId" = c.id
        JOIN "TransactionItem" ti ON ti."transactionId" = t.id
        WHERE t."createdAt" >= (${startDate}::timestamptz AT TIME ZONE 'UTC')
          AND t.cancelled = false
          AND t.type = 'SALE'
          AND ti."articleId" IN (${Prisma.join(articleIds)})
        GROUP BY c.id, c.name, c.nickname
        ORDER BY score DESC
        LIMIT ${Prisma.raw(String(settings.displayCount))}
      `
    );

    const entries = rows.map((r, i) => ({
      rank: i + 1,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerNickname: r.customer_nickname,
      score: Number(r.score || 0),
      transactionCount: Number(r.transaction_count || 0),
      ...(mode === 'AMOUNT'
        ? { totalItems: Number(r.total_items || 0) }
        : { totalAmount: Number(r.total_amount || 0) }),
    }));

    return { type, mode, startDate, entries, lastUpdated: new Date() };
  }

  /**
   * Alle vier Boards aus einem Kontext; Ergebnis BOARD_CACHE_TTL_MS lang gecacht,
   * parallele Aufrufer teilen sich eine laufende Berechnung. `fresh` erzwingt Neuberechnung
   * (nach Verkauf/Reset) und aktualisiert den Cache.
   */
  async getAllBoards({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh) {
      if (this._boardsCache.data && now - this._boardsCache.at < BOARD_CACHE_TTL_MS) return this._boardsCache.data;
      if (this._boardsCache.promise) return this._boardsCache.promise;
    }
    const promise = (async () => {
      const ctx = await this._buildContext();
      const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
        this.calculateHighscore('DAILY', 'AMOUNT', ctx),
        this.calculateHighscore('DAILY', 'COUNT', ctx),
        this.calculateHighscore('YEARLY', 'AMOUNT', ctx),
        this.calculateHighscore('YEARLY', 'COUNT', ctx),
      ]);
      const data = { daily: { amount: dailyAmount, count: dailyCount }, yearly: { amount: yearlyAmount, count: yearlyCount } };
      this._boardsCache = { at: Date.now(), data, promise: null };
      return data;
    })();
    this._boardsCache.promise = promise;
    try {
      return await promise;
    } catch (err) {
      if (this._boardsCache.promise === promise) this._boardsCache.promise = null;
      throw err;
    }
  }

  invalidateBoards() {
    this._boardsCache = { at: 0, data: null, promise: null };
  }

  /**
   * Archiv der Jahreswertungen: jeder manuelle Reset hat den Stand davor im AuditLog
   * (`changes.archivedHighscore` / `archivedHighscoreCount`) eingefroren. Neueste zuerst.
   * `top` kuerzt die Eintraege (Public-Display: 3), sonst voller Top-20-Stand.
   */
  async getArchive({ top = null, limit = 24 } = {}) {
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'Highscore', action: 'RESET_YEARLY_HIGHSCORE' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    });
    const cut = (arr) => (top ? (arr || []).slice(0, top) : (arr || []));
    return rows.map((r) => {
      const amount = r.changes?.archivedHighscore || {};
      const count = r.changes?.archivedHighscoreCount || {};
      return {
        id: r.id,
        periodStart: r.changes?.periodStart || amount.startDate || null,
        periodEnd: r.createdAt,
        resetAt: r.createdAt,
        resetBy: r.user?.name || null,
        entriesCount: (amount.entries || []).length,
        amount: { entries: cut(amount.entries) },
        count: { entries: cut(count.entries) },
      };
    });
  }

  async getCustomerPosition(customerId, type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    const startDate = await this._getPeriodStart(type, settings.dailyResetHour);
    const articleIds = await this._getCountingArticleIds(settings.countInactiveArticles);
    if (!articleIds.length) return null;

    const scoreExpr =
      mode === 'AMOUNT'
        ? Prisma.sql`SUM(ti."totalPrice")`
        : Prisma.sql`SUM(ti.quantity)`;

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        WITH customer_scores AS (
          SELECT
            c.id,
            c.name,
            c.nickname,
            ${scoreExpr} AS score,
            RANK() OVER (ORDER BY ${scoreExpr} DESC) AS rk
          FROM "Customer" c
          JOIN "Transaction" t    ON t."customerId" = c.id
          JOIN "TransactionItem" ti ON ti."transactionId" = t.id
          WHERE t."createdAt" >= (${startDate}::timestamptz AT TIME ZONE 'UTC')
            AND t.cancelled = false
            AND t.type = 'SALE'
            AND ti."articleId" IN (${Prisma.join(articleIds)})
          GROUP BY c.id, c.name, c.nickname
        )
        SELECT * FROM customer_scores WHERE id = ${customerId}
      `
    );

    if (!rows.length) return null;
    const r = rows[0];
    return {
      customerId: r.id,
      customerName: r.name,
      customerNickname: r.nickname,
      score: Number(r.score || 0),
      rank: Number(r.rk || 0),
    };
  }

  /* ---------- Goals-Progress ---------- */
  // wir legen die Konfiguration “leichtgewichtig” in AuditLog ab (kannst du später in eigene Tabelle auslagern)
  async _readGoalsConfig() {
    const last = await prisma.auditLog.findFirst({
      where: { entityType: 'HighscoreGoals', action: 'SET' },
      orderBy: { createdAt: 'desc' }
    });
    return last?.changes?.goals || [];
  }

  async _writeGoalsConfig(goals, movingTargets, userId) {
    await prisma.auditLog.create({
      data: {
        userId: userId || 'system',
        action: 'SET',
        entityType: 'HighscoreGoals',
        entityId: 'daily',
        changes: { goals, movingTargets },
      }
    });
  }

  async setGoals(goals, movingTargets, userId) {
    // goals: [{articleId, targetUnits, label}]
    const clean = (goals || [])
      .filter(g => g && g.articleId && Number(g.targetUnits) > 0)
      .slice(0, 4)
      .map(g => ({ articleId: g.articleId, targetUnits: Number(g.targetUnits), label: String(g.label || '') }));

    await this._writeGoalsConfig(clean, !!movingTargets, userId);
    return { ok: true, goals: clean, movingTargets: !!movingTargets };
  }

  async getGoalsProgress() {
    const settings = await this.getSettings();
    const { start, end } = this._getDailyWindow(settings.dailyResetHour);

    // Custom read to get movingTargets flag
    const log = await prisma.auditLog.findFirst({
      where: { entityType: 'HighscoreGoals', action: 'SET' },
      orderBy: { createdAt: 'desc' }
    });
    const cfg = log?.changes?.goals || [];
    const movingTargets = log?.changes?.movingTargets ?? false;

    if (!cfg.length) {
      return {
        goals: [],
        meta: {
          dayLabel: `Tag: ${businessDayLabel(settings.dailyResetHour)}`,
          goalsConfig: [],
          movingTargets
        }
      };
    }

    // hole Ziel-Artikel-Daten (unitsPerPurchase/PurchaseUnit)
    const ids = cfg.map(c => c.articleId);
    const arts = await prisma.article.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, unitsPerPurchase: true, purchaseUnit: true, unit: true }
    });
    const aMap = new Map(arts.map(a => [a.id, a]));

    // Summiere verkaufte Mengen im Tagesfenster
    const rows = await prisma.transactionItem.groupBy({
      by: ['articleId'],
      where: {
        articleId: { in: ids },
        transaction: { cancelled: false, type: 'SALE', createdAt: { gte: start, lt: end } }
      },
      _sum: { quantity: true }
    });

    const sumMap = new Map(rows.map(r => [r.articleId, Number(r._sum.quantity || 0)]));

    const goals = cfg.map(g => {
      const a = aMap.get(g.articleId);
      const totalUnits = Number(sumMap.get(g.articleId) || 0);
      const step = Math.max(1, Number(a?.unitsPerPurchase || 1));
      return {
        articleId: g.articleId,
        articleName: a?.name || 'Artikel',
        targetUnits: Number(g.targetUnits),
        totalUnits,
        purchaseUnit: a?.purchaseUnit || (step > 1 ? (a?.unit || 'Stück') : (a?.unit || 'Stück')),
        unitsPerPurchase: step,
        label: g.label || a?.name || 'Ziel'
      };
    });

    return {
      goals,
      meta: {
        dayLabel: `Tag: ${businessDayLabel(settings.dailyResetHour)}`,
        goalsConfig: cfg,
        movingTargets
      }
    };
  }

  /* ---------- Events nach Verkäufen ---------- */
  /** Boards frisch rechnen und pushen (z.B. nach Storno, der ein Ranking verändern kann) */
  async refreshBoards() {
    try {
      const boards = await this.getAllBoards({ fresh: true });
      emitHighscoreUpdate(boards);
    } catch (err) {
      console.error('Error refreshing highscore:', err);
    }
  }

  async updateAfterSale(transactionId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { customer: true, items: { include: { article: true } } },
      });
      if (!transaction || !transaction.customerId || transaction.cancelled) return;

      const hasRelevant = transaction.items.some(it => it.article?.countsForHighscore);
      if (!hasRelevant) return;

      const boards = await this.getAllBoards({ fresh: true });
      emitHighscoreUpdate(boards);
    } catch (err) {
      console.error('Error updating highscore:', err);
    }
  }

  async resetHighscore(type, userId) {
    if (type !== 'YEARLY') {
      throw new Error('Nur der Jahres-Highscore kann manuell zurückgesetzt werden');
    }
    // Stand vor dem Reset in beiden Modi archivieren; der AuditLog-Eintrag ist
    // zugleich die Startmarke der neuen Jahreswertung (siehe _yearlyStartFrom).
    const [archivedAmount, archivedCount] = await Promise.all([
      this.calculateHighscore('YEARLY', 'AMOUNT'),
      this.calculateHighscore('YEARLY', 'COUNT'),
    ]);
    const created = await prisma.auditLog.create({
      data: {
        userId, action: 'RESET_YEARLY_HIGHSCORE', entityType: 'Highscore', entityId: 'yearly',
        changes: {
          periodStart: archivedAmount.startDate,
          archivedHighscore: archivedAmount,
          archivedHighscoreCount: archivedCount,
        },
      },
    });

    const boards = await this.getAllBoards({ fresh: true });
    emitHighscoreUpdate({ ...boards, reset: true, resetType: 'YEARLY' });
    return { resetAt: created.createdAt, archivedEntries: archivedAmount.entries.length };
  }

  /* Customer Achievements – unverändert zu deinem Stand, hier gekürzt */
  async getCustomerAchievements(customerId) {
    const achievements = [];
    const [
      totalTransactions,
      totalSpent,
      favoriteArticle,
    ] = await Promise.all([
      prisma.transaction.count({ where: { customerId, cancelled: false, type: 'SALE' } }),
      prisma.transaction.aggregate({ where: { customerId, cancelled: false, type: 'SALE' }, _sum: { totalAmount: true } }),
      prisma.$queryRaw`
        SELECT a.name, COUNT(*) as count
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId} AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 1
      `,
    ]);

    if (totalTransactions >= 100) achievements.push({ id: 'century', name: 'Jahrhundert-Kunde', description: '100 Einkäufe getätigt', icon: '💯' });
    if (totalTransactions >= 10) achievements.push({ id: 'regular', name: 'Stammkunde', description: '10 Einkäufe getätigt', icon: '⭐' });
    if (Number(totalSpent._sum.totalAmount || 0) >= 500) achievements.push({ id: 'big_spender', name: 'Großzügig', description: '500€ ausgegeben', icon: '💰' });
    if (favoriteArticle.length && Number(favoriteArticle[0].count) >= 50) achievements.push({ id: 'loyal_fan', name: `${favoriteArticle[0].name}-Fan`, description: `50x ${favoriteArticle[0].name} gekauft`, icon: '❤️' });
    return achievements;
  }
}

module.exports = new HighscoreService();
