const prisma = require('../utils/prisma');

function triggerRefreshBoards() {
  try {
    const hs = require('./highscoreService');
    Promise.resolve(hs.refreshBoards?.()).catch((err) =>
      console.error('[ArticleService] refreshBoards Fehler:', err)
    );
  } catch (err) {
    console.error('[ArticleService] highscoreService laden fehlgeschlagen:', err);
  }
}

// Reihenfolge der Kategorien (Verkaufsreiter, Artikelseite). Kategorien selbst sind Freitext am Artikel;
// gespeichert wird nur die Reihenfolge der Namen. Nicht genannte Kategorien folgen alphabetisch.
const CATEGORY_ORDER_KEY = 'ARTICLE_CATEGORY_ORDER';
// Platzhalter für den Reiter „Alles“ in der gespeicherten Reihenfolge. Fehlt er, steht „Alles“ am Ende.
const ALL_TAB = '__ALLES__';
const GOALS_KEY = 'clubscore.goals'; // wie highscoreService (SETTING_GOALS)

function sortCategoryNames(names, order) {
  const pos = new Map(order.map((n, i) => [n, i]));
  return [...names].sort((a, b) => {
    const pa = pos.has(a) ? pos.get(a) : Infinity;
    const pb = pos.has(b) ? pos.get(b) : Infinity;
    return pa !== pb ? pa - pb : a.localeCompare(b, 'de');
  });
}

const cleanNames = (list) => [...new Set((Array.isArray(list) ? list : []).map((n) => String(n ?? '').trim()).filter(Boolean))];

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

    // Vorherigen Stand laden, um Änderungen an highscore-relevanten Feldern zu erkennen
    const before = await prisma.article.findUnique({ where: { id }, select: { countsForHighscore: true, active: true } });

    const article = await prisma.article.update({
      where: { id },
      data: {
        name: updateData.name,
        price: updateData.price,
        minStock: updateData.minStock,
        unit: updateData.unit,
        category: updateData.category,
        order: updateData.order !== undefined ? Number(updateData.order) : undefined,
        // undefined = unverändert, null = Bild entfernt
        imageUrl: updateData.imageUrl,
        imageThumbnail: updateData.imageThumbnail,
        imageSmall: updateData.imageSmall,
        imageMedium: updateData.imageMedium,
        imageLarge: updateData.imageLarge,
        countsForHighscore:
          typeof updateData.countsForHighscore === 'boolean'
            ? updateData.countsForHighscore
            : undefined,
        active: typeof updateData.active === 'boolean' ? updateData.active : undefined,
        purchaseUnit: updateData.purchaseUnit ?? undefined,
        unitsPerPurchase: updateData.unitsPerPurchase ?? undefined,
      },
    });

    if (stockAdjustment && stockAdjustment !== 0) {
      await this.adjustStock(id, stockAdjustment, adjustmentReason || 'Manuelle Anpassung');
    }

    // Highscore neu berechnen falls relevante Felder geändert wurden
    if (before) {
      const highscoreChanged =
        (typeof updateData.countsForHighscore === 'boolean' && updateData.countsForHighscore !== before.countsForHighscore) ||
        (typeof updateData.active === 'boolean' && updateData.active !== before.active);
      if (highscoreChanged) triggerRefreshBoards();
    }

    return article;
  }

  // Aktivieren/Deaktivieren
  async toggleArticleStatus(id) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) throw new Error('Artikel nicht gefunden');
    const updated = await prisma.article.update({ where: { id }, data: { active: !article.active } });
    // active geändert → Highscore aktualisieren
    triggerRefreshBoards();
    return updated;
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

  // --- Kategorien -------------------------------------------------------------

  async getCategoryOrder() {
    const row = await prisma.systemSetting.findUnique({ where: { key: CATEGORY_ORDER_KEY } });
    try {
      return cleanNames(JSON.parse(row?.value || '[]'));
    } catch {
      return [];
    }
  }

  async setCategoryOrder(names, tx = prisma) {
    const value = JSON.stringify(cleanNames(names));
    await tx.systemSetting.upsert({
      where: { key: CATEGORY_ORDER_KEY },
      update: { value },
      create: { key: CATEGORY_ORDER_KEY, value, description: 'Reihenfolge der Artikelkategorien' },
    });
  }

  // Position des Reiters „Alles“ unter den sortierten Kategorien (0 = ganz vorne, Länge = am Ende)
  allTabPosition(order, sortedNames) {
    const i = order.indexOf(ALL_TAB);
    if (i < 0) return sortedNames.length;
    const before = new Set(order.slice(0, i));
    const known = new Set(order);
    // Neue, noch nicht einsortierte Kategorien hängen hinten an; steht „Alles“ hinter allen bekannten, bleibt es am Ende
    if (sortedNames.filter((n) => known.has(n)).every((n) => before.has(n))) return sortedNames.length;
    return sortedNames.filter((n) => before.has(n)).length;
  }

  // Kategorien + fertige Reiterliste für den Verkauf (ALL_TAB = „Alles“ an seiner Position)
  async categoryOverview() {
    const order = await this.getCategoryOrder();
    const categories = await this.listCategories(order);
    const names = categories.map((c) => c.name);
    const allPosition = this.allTabPosition(order, names);
    return { categories, allPosition, allTab: ALL_TAB, tabs: [...names.slice(0, allPosition), ALL_TAB, ...names.slice(allPosition)] };
  }

  // [{ name, articleCount, activeCount }] in gespeicherter Reihenfolge
  async listCategories(knownOrder) {
    const [order, groups] = await Promise.all([
      knownOrder || this.getCategoryOrder(),
      prisma.article.groupBy({ by: ['category', 'active'], _count: { _all: true } }),
    ]);
    const stats = new Map();
    for (const g of groups) {
      const s = stats.get(g.category) || { name: g.category, articleCount: 0, activeCount: 0 };
      s.articleCount += g._count._all;
      if (g.active) s.activeCount += g._count._all;
      stats.set(g.category, s);
    }
    return sortCategoryNames([...stats.keys()], order).map((n) => stats.get(n));
  }

  // Neue Reihenfolge speichern (darf ALL_TAB enthalten); vorhandene, nicht genannte Kategorien hängen hinten an
  async saveCategoryOrder(names) {
    const wanted = cleanNames(names);
    const existing = (await this.listCategories()).map((c) => c.name);
    const missing = existing.filter((n) => !wanted.includes(n));
    // Steht „Alles“ am Ende, kommen fehlende Kategorien davor, damit „Alles“ der letzte Reiter bleibt
    const order = wanted[wanted.length - 1] === ALL_TAB
      ? [...wanted.slice(0, -1), ...missing, ALL_TAB]
      : [...wanted, ...missing];
    await this.setCategoryOrder(order);
    return this.categoryOverview();
  }

  // Umbenennen; gibt es den neuen Namen schon, werden beide Kategorien zusammengeführt.
  // Mit umgestellt werden alle Stellen, die den Namen als Text speichern: Clubscore-Ziele (Typ Kategorie)
  // und Menü-Elemente auf Werbe-Folien.
  async renameCategory(from, to) {
    const oldName = String(from ?? '').trim();
    const newName = String(to ?? '').trim();
    if (!oldName || !newName) throw new Error('Kategoriename fehlt');
    if (oldName === newName) return { count: 0, merged: false };
    const stored = await this.getCategoryOrder();
    const existing = (await this.listCategories(stored)).map((c) => c.name);
    const merged = existing.includes(newName);
    // gespeicherte Reihenfolge (inkl. Platzhalter „Alles“) übernehmen, nur den Namen tauschen bzw. entfernen
    const nextOrder = merged ? stored.filter((n) => n !== oldName) : stored.map((n) => (n === oldName ? newName : n));
    const same = (v) => String(v ?? '').trim().toLowerCase() === oldName.toLowerCase();
    const result = await prisma.$transaction(async (tx) => {
      const r = await tx.article.updateMany({ where: { category: oldName }, data: { category: newName } });
      await this.setCategoryOrder(nextOrder, tx);

      // Clubscore-Ziele
      let goals = 0;
      const goalRow = await tx.systemSetting.findUnique({ where: { key: GOALS_KEY } });
      if (goalRow) {
        let cfg = null;
        try { cfg = JSON.parse(goalRow.value); } catch { cfg = null; }
        if (cfg && Array.isArray(cfg.goals)) {
          cfg.goals = cfg.goals.map((g) => (g?.kind === 'CATEGORY' && same(g.category) ? (goals++, { ...g, category: newName }) : g));
          if (goals) await tx.systemSetting.update({ where: { key: GOALS_KEY }, data: { value: JSON.stringify(cfg) } });
        }
      }

      // Werbe-Folien mit Menü-Element
      let slides = 0;
      for (const slide of await tx.adSlide.findMany({ select: { id: true, slideData: true } })) {
        const els = slide.slideData?.elements;
        if (!Array.isArray(els) || !els.some((e) => e?.type === 'menu' && same(e.content))) continue;
        const elements = els.map((e) => (e?.type === 'menu' && same(e.content) ? { ...e, content: newName } : e));
        await tx.adSlide.update({ where: { id: slide.id }, data: { slideData: { ...slide.slideData, elements } } });
        slides++;
      }
      return { count: r.count, goals, slides };
    });
    if (result.goals) triggerRefreshBoards();
    return { ...result, merged };
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
