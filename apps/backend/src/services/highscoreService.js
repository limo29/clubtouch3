const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { emitHighscoreUpdate } = require('../utils/websocket');

class HighscoreService {
  async getSettings() {
    // Kannst du später aus DB/ENV laden
    return {
      dailyResetHour: 12,          // 12:00 -> Tag läuft 12:00 bis 12:00
      displayCount: 20,            // Top 20
      countInactiveArticles: false,
      scoreMode: 'AMOUNT'
    };
  }

  _getPeriodStart(type, resetHour = 12) {
    const now = new Date();

    if (type === 'DAILY') {
      const start = new Date();
      start.setHours(resetHour, 0, 0, 0);
      if (now < start) start.setDate(start.getDate() - 1);
      return start;
    }
    if (type === 'YEARLY') {
      return new Date(now.getFullYear(), 0, 1);
    }
    const start = new Date();
    start.setHours(resetHour, 0, 0, 0);
    return start;
  }

  _getDailyWindow(resetHour = 12) {
    // liefert [start, end) für “heute” von 12:00 bis 12:00
    const start = this._getPeriodStart('DAILY', resetHour);
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

  async calculateHighscore(type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    const startDate = this._getPeriodStart(type, settings.dailyResetHour);
    const articleIds = await this._getCountingArticleIds(settings.countInactiveArticles);

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
        WHERE t."createdAt" >= ${startDate}
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

  async getCustomerPosition(customerId, type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    const startDate = this._getPeriodStart(type, settings.dailyResetHour);
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
          WHERE t."createdAt" >= ${startDate}
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

  async _writeGoalsConfig(goals, userId) {
    await prisma.auditLog.create({
      data: {
        userId: userId || 'system',
        action: 'SET',
        entityType: 'HighscoreGoals',
        entityId: 'daily',
        changes: { goals },
      }
    });
  }

  async setGoals(goals, userId) {
    // goals: [{articleId, targetUnits, label}]
    const clean = (goals || [])
      .filter(g => g && g.articleId && Number(g.targetUnits) > 0)
      .slice(0, 4)
      .map(g => ({ articleId: g.articleId, targetUnits: Number(g.targetUnits), label: String(g.label || '') }));
    await this._writeGoalsConfig(clean, userId);
    return { ok: true, goals: clean };
  }

  async getGoalsProgress() {
    const settings = await this.getSettings();
    const { start, end } = this._getDailyWindow(settings.dailyResetHour);
    const cfg = await this._readGoalsConfig();
    if (!cfg.length) {
      return {
        goals: [],
        meta: { dayLabel: `Tag: ${String(settings.dailyResetHour).padStart(2, '0')}:00 → ${String(settings.dailyResetHour).padStart(2, '0')}:00`, goalsConfig: [] }
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
        dayLabel: `Tag: ${String(settings.dailyResetHour).padStart(2, '0')}:00 → ${String(settings.dailyResetHour).padStart(2, '0')}:00`,
        goalsConfig: cfg
      }
    };
  }

  /* ---------- Events nach Verkäufen ---------- */
  async updateAfterSale(transactionId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { customer: true, items: { include: { article: true } } },
      });
      if (!transaction || !transaction.customerId || transaction.cancelled) return;

      const hasRelevant = transaction.items.some(it => it.article?.countsForHighscore);
      if (!hasRelevant) return;

      const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
        this.calculateHighscore('DAILY', 'AMOUNT'),
        this.calculateHighscore('DAILY', 'COUNT'),
        this.calculateHighscore('YEARLY', 'AMOUNT'),
        this.calculateHighscore('YEARLY', 'COUNT'),
      ]);

      emitHighscoreUpdate({
        daily: { amount: dailyAmount, count: dailyCount },
        yearly: { amount: yearlyAmount, count: yearlyCount }
      });
    } catch (err) {
      console.error('Error updating highscore:', err);
    }
  }

  async resetHighscore(type, userId) {
    if (type !== 'YEARLY') {
      throw new Error('Nur der Jahres-Highscore kann manuell zurückgesetzt werden');
    }
    const current = await this.calculateHighscore('YEARLY', 'AMOUNT');
    await prisma.auditLog.create({
      data: { userId, action: 'RESET_YEARLY_HIGHSCORE', entityType: 'Highscore', entityId: 'yearly', changes: { archivedHighscore: current } },
    });

    const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
      this.calculateHighscore('DAILY', 'AMOUNT'),
      this.calculateHighscore('DAILY', 'COUNT'),
      this.calculateHighscore('YEARLY', 'AMOUNT'),
      this.calculateHighscore('YEARLY', 'COUNT'),
    ]);

    emitHighscoreUpdate({
      daily: { amount: dailyAmount, count: dailyCount },
      yearly: { amount: yearlyAmount, count: yearlyCount },
      reset: true, resetType: 'YEARLY',
    });
  }

  /* Customer Achievements – unverändert zu deinem Stand, hier gekürzt */
  async getCustomerAchievements(customerId) {
    const achievements = [];
    const [
      totalTransactions,
      totalSpent,
      favoriteArticle,
    ] = await Promise.all([
      prisma.transaction.count({ where: { customerId, cancelled: false } }),
      prisma.transaction.aggregate({ where: { customerId, cancelled: false }, _sum: { totalAmount: true } }),
      prisma.$queryRaw`
        SELECT a.name, COUNT(*) as count
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId} AND t.cancelled = false
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
