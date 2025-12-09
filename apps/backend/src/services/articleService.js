const prisma = require('../utils/prisma');

class ArticleService {
  // Liste alle Artikel
  async listArticles(includeInactive = false) {
    const where = includeInactive ? {} : { active: true };
    return prisma.article.findMany({
      where,
      orderBy: [{ order: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
  }

  // Finde Artikel by ID
  async findById(id) {
    return prisma.article.findUnique({
      where: { id },
      include: {
        stockMovements: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  // Erstelle neuen Artikel
  async createArticle(data) {
    const article = await prisma.article.create({
      data: {
        name: data.name,
        price: data.price,                // String -> Decimal (Prisma)
        stock: data.initialStock || 0,
        minStock: data.minStock || 0,
        unit: data.unit || 'Stück',
        category: data.category,
        order: Number(data.order) || 0,
        imageUrl: data.imageUrl || null,
        imageThumbnail: data.imageThumbnail || null,
        imageSmall: data.imageSmall || null,
        imageMedium: data.imageMedium || null,
        imageLarge: data.imageLarge || null,
        countsForHighscore: data.countsForHighscore !== false,
        purchaseUnit: data.purchaseUnit || null,
        unitsPerPurchase: data.unitsPerPurchase || null,
      },
    });

    // initiale Bestandsbewegung
    if (data.initialStock > 0) {
      await prisma.stockMovement.create({
        data: {
          articleId: article.id,
          type: 'INVENTORY',
          quantity: data.initialStock,
          reason: 'Initial-Bestand',
        },
      });
    }

    return article;
  }

  // Update Artikel
  async updateArticle(id, data) {
    const { stockAdjustment, adjustmentReason, ...updateData } = data;

    const article = await prisma.article.update({
      where: { id },
      data: {
        name: updateData.name,
        price: updateData.price,
        minStock: updateData.minStock,
        unit: updateData.unit,
        category: updateData.category,
        order: updateData.order !== undefined ? Number(updateData.order) : undefined,
        imageUrl: updateData.imageUrl ?? undefined,
        imageThumbnail: updateData.imageThumbnail ?? undefined,
        imageSmall: updateData.imageSmall ?? undefined,
        imageMedium: updateData.imageMedium ?? undefined,
        imageLarge: updateData.imageLarge ?? undefined,
        countsForHighscore:
          typeof updateData.countsForHighscore === 'boolean'
            ? updateData.countsForHighscore
            : undefined,
        purchaseUnit: updateData.purchaseUnit ?? undefined,
        unitsPerPurchase: updateData.unitsPerPurchase ?? undefined,
      },
    });

    if (stockAdjustment && stockAdjustment !== 0) {
      await this.adjustStock(id, stockAdjustment, adjustmentReason || 'Manuelle Anpassung');
    }
    return article;
  }

  // Aktivieren/Deaktivieren
  async toggleArticleStatus(id) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) throw new Error('Artikel nicht gefunden');
    return prisma.article.update({ where: { id }, data: { active: !article.active } });
  }

  // Bestand anpassen
  async adjustStock(articleId, quantity, reason, type = 'CORRECTION') {
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new Error('Artikel nicht gefunden');

    const allowNegative = String(process.env.ALLOW_NEGATIVE_STOCK || 'true').toLowerCase() === 'true';

    // bisheriger Bestand + Änderung
    const current = Number(article.stock);
    const delta = Number(quantity);
    const newStock = current + delta;

    // WENN negatives Lager verboten ist -> wie vorher blockieren
    if (!allowNegative && newStock < 0) {
      throw new Error(
        `Bestand kann nicht negativ werden. Aktuell: ${current}, Änderung: ${delta}`
      );
    }

    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: { stock: newStock }, // negative Werte sind erlaubt
    });

    await prisma.stockMovement.create({
      data: {
        articleId,
        type,
        quantity: delta,
        reason: reason || (newStock < 0 ? 'Warnung: Bestand negativ' : undefined),
      },
    });

    // optional: Audit-Log mit Negativ-Warnung
    if (newStock < 0) {
      await prisma.auditLog.create({
        data: {
          userId: 'system', // oder req.user.id an Aufruferstellen durchreichen
          action: 'NEGATIVE_STOCK_WARNING',
          entityType: 'Article',
          entityId: articleId,
          changes: { previous: current, delta, newStock, reason },
        },
      });
    }

    return updatedArticle;
  }


  // Wareneingang
  async processDelivery(articleId, quantity, reason = 'Wareneingang') {
    if (quantity <= 0) throw new Error('Menge muss größer als 0 sein');
    return this.adjustStock(articleId, quantity, reason, 'DELIVERY');
  }

  // Inventur
  async processInventory(articleId, actualStock, reason = 'Inventur') {
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new Error('Artikel nicht gefunden');
    const difference = Number(actualStock) - Number(article.stock);
    if (difference === 0) return article;
    return this.adjustStock(articleId, difference, reason, 'INVENTORY');
  }

  // Bestandswarnungen
  async checkLowStock() {
    return prisma.article.findMany({
      where: { active: true, stock: { lte: prisma.article.fields.minStock } },
      orderBy: { stock: 'asc' },
    });
  }

  // Statistiken
  async getArticleStats(articleId) {
    const [article, salesCount, totalRevenue] = await Promise.all([
      prisma.article.findUnique({ where: { id: articleId } }),
      prisma.transactionItem.count({
        where: { articleId, transaction: { cancelled: false } },
      }),
      prisma.transactionItem.aggregate({
        where: { articleId, transaction: { cancelled: false } },
        _sum: { totalPrice: true },
      }),
    ]);

    return {
      article,
      salesCount,
      totalRevenue: totalRevenue._sum.totalPrice || 0,
    };
  }

  // Batch Reorder
  async reorderArticles(items) {
    // items: [{ id: '...', order: 1 }, ...]
    const updates = items.map((item) =>
      prisma.article.update({
        where: { id: item.id },
        data: { order: item.order },
      })
    );
    return prisma.$transaction(updates);
  }
}

module.exports = new ArticleService();
