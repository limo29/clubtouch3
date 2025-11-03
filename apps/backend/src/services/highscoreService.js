// src/services/highscoreService.js
const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { emitHighscoreUpdate } = require('../utils/websocket');

class HighscoreService {
  async getSettings() {
    return {
      dailyResetHour: 12,          // 12:00
      displayCount: 10,            // Top 10
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
      return new Date(now.getFullYear(), 0, 1); // 01.01.
    }

    // Fallback: heute
    const start = new Date();
    start.setHours(resetHour, 0, 0, 0);
    return start;
  }

  async _getCountingArticleIds(includeInactive) {
    const articles = await prisma.article.findMany({
      where: {
        countsForHighscore: true,
        ...(includeInactive ? {} : { active: true }),
      },
      select: { id: true },
    });
    return articles.map(a => a.id);
  }

  async calculateHighscore(type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    const startDate = this._getPeriodStart(type, settings.dailyResetHour);

    const articleIds = await this._getCountingArticleIds(settings.countInactiveArticles);

    // Wenn keine Artikel mitzählen -> leer zurückgeben (explizit)
    if (!articleIds.length) {
      return { type, mode, startDate, entries: [], lastUpdated: new Date() };
    }

    // Baue dynamische Teile
    const scoreExpr =
      mode === 'AMOUNT'
        ? Prisma.sql`SUM(ti."totalPrice")::decimal`
        : Prisma.sql`SUM(ti.quantity)::int`;

    const extraExpr =
      mode === 'AMOUNT'
        ? Prisma.sql`SUM(ti.quantity)::int AS total_items`
        : Prisma.sql`SUM(ti."totalPrice")::decimal AS total_amount`;

    // Wichtig: IN (...) mit Prisma.join(articleIds)
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

  async updateAfterSale(transactionId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          customer: true,
          items: { include: { article: true } },
        },
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

      const [customerDailyAmount, customerDailyCount] = await Promise.all([
        this.getCustomerPosition(transaction.customerId, 'DAILY', 'AMOUNT'),
        this.getCustomerPosition(transaction.customerId, 'DAILY', 'COUNT'),
      ]);

      emitHighscoreUpdate({
        daily: { amount: dailyAmount, count: dailyCount },
        yearly: { amount: yearlyAmount, count: yearlyCount },
        customerPosition: {
          customerId: transaction.customerId,
          daily: { amount: customerDailyAmount, count: customerDailyCount },
        },
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
      data: {
        userId,
        action: 'RESET_YEARLY_HIGHSCORE',
        entityType: 'Highscore',
        entityId: 'yearly',
        changes: { archivedHighscore: current },
      },
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
      reset: true,
      resetType: 'YEARLY',
    });
  }

  // (Achievements bleibt wie bei dir)
  async getCustomerAchievements(customerId) {
    const achievements = [];
    const [
      totalTransactions,
      totalSpent,
      favoriteArticle,
    ] = await Promise.all([
      prisma.transaction.count({ where: { customerId, cancelled: false } }),
      prisma.transaction.aggregate({
        where: { customerId, cancelled: false },
        _sum: { totalAmount: true },
      }),
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

    if (totalTransactions >= 100) achievements.push({ id:'century', name:'Jahrhundert-Kunde', description:'100 Einkäufe getätigt', icon:'💯' });
    if (totalTransactions >= 10)  achievements.push({ id:'regular',  name:'Stammkunde',        description:'10 Einkäufe getätigt',  icon:'⭐'  });
    if (Number(totalSpent._sum.totalAmount || 0) >= 500)
      achievements.push({ id:'big_spender', name:'Großzügig', description:'500€ ausgegeben', icon:'💰' });
    if (favoriteArticle.length && Number(favoriteArticle[0].count) >= 50)
      achievements.push({ id:'loyal_fan', name:`${favoriteArticle[0].name}-Fan`, description:`50x ${favoriteArticle[0].name} gekauft`, icon:'❤️' });

    return achievements;
  }
}

module.exports = new HighscoreService();
