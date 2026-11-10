const articleService = require('../services/articleService');
const fileUploadService = require('../services/fileUploadService');
const prisma = require('../utils/prisma');
const { sendError } = require('../utils/httpError');

// Prisma Decimal mag Strings -> kleine Helper
const toDecimalString = (v) =>
  v === undefined || v === null || v === '' ? undefined : String(v).replace(',', '.');

// Helper to sanitize URLs (remove internal backend host)
const sanitizeUrl = (url) => {
  if (!url) return url;
  return url.replace(/^http:\/\/(backend|localhost):\d+/, '');
};

// Formulardaten kommen als Text: "true"/"false" -> Boolean, sonst undefined (= unverändert)
const toBool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined);

// Bildpfade setzt nur der Upload selbst. Aus dem Body übernommen könnte man sonst einen beliebigen
// Upload (z.B. einen Belegnachweis) eintragen, der beim nächsten Bildwechsel gelöscht wird.
const IMAGE_FIELDS = ['imageUrl', 'imageThumbnail', 'imageSmall', 'imageMedium', 'imageLarge'];
const withoutImageFields = (body) => {
  const data = { ...body };
  for (const key of IMAGE_FIELDS) delete data[key];
  return data;
};

const sanitizeArticle = (article) => {
  if (!article) return article;
  return {
    ...article,
    imageUrl: sanitizeUrl(article.imageUrl),
    imageThumbnail: sanitizeUrl(article.imageThumbnail),
    imageSmall: sanitizeUrl(article.imageSmall),
    imageMedium: sanitizeUrl(article.imageMedium),
    imageLarge: sanitizeUrl(article.imageLarge),
  };
};

class ArticleController {
  // Liste alle Artikel
  async listArticles(req, res) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const articles = (await articleService.listArticles(includeInactive)).map(sanitizeArticle);
      res.json({ articles, count: articles.length });
    } catch (error) {
      console.error('List articles error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Artikel' });
    }
  }

  // Einzelnen Artikel abrufen
  async getArticle(req, res) {
    try {
      const { id } = req.params;
      const article = await articleService.findById(id);
      if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
      res.json({ article: sanitizeArticle(article) });
    } catch (error) {
      console.error('Get article error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Artikels' });
    }
  }

  // Neuen Artikel erstellen
  async createArticle(req, res) {
    console.log('[articles] req.file?', !!req.file, req.headers['content-type']);

    try {
      const articleData = withoutImageFields(req.body);

      // Zahlen normalisieren
      articleData.price = toDecimalString(articleData.price);
      articleData.initialStock = toDecimalString(articleData.initialStock);
      articleData.minStock = toDecimalString(articleData.minStock);

      articleData.unitsPerPurchase = toDecimalString(articleData.unitsPerPurchase);
      articleData.countsForHighscore = toBool(articleData.countsForHighscore);
      if (articleData.order) articleData.order = parseInt(articleData.order, 10);
      if (articleData.purchaseUnit === '') articleData.purchaseUnit = undefined;

      // Bild verarbeitet?
      if (req.file) {
        const imagePaths = await fileUploadService.processArticleImage(req.file);
        articleData.imageUrl = imagePaths.original;
        articleData.imageThumbnail = imagePaths.thumbnail;
        articleData.imageSmall = imagePaths.small;
        articleData.imageMedium = imagePaths.medium;
        articleData.imageLarge = imagePaths.large;
      }

      const article = await articleService.createArticle(articleData);

      // Audit
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_ARTICLE',
          entityType: 'Article',
          entityId: article.id,
          changes: articleData,
        },
      });

      res.status(201).json({ message: 'Artikel erfolgreich erstellt', article: sanitizeArticle(article) });
    } catch (error) {
      console.error('Create article error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen des Artikels' });
    }
  }

  // Artikel aktualisieren
  async updateArticle(req, res) {
    console.log('[articles] req.file?', !!req.file, req.headers['content-type']);

    try {
      const { id } = req.params;
      const updateData = withoutImageFields(req.body);

      // Zahlen normalisieren
      updateData.price = toDecimalString(updateData.price);
      updateData.minStock = toDecimalString(updateData.minStock);

      updateData.unitsPerPurchase = toDecimalString(updateData.unitsPerPurchase);
      updateData.countsForHighscore = toBool(updateData.countsForHighscore);
      updateData.active = toBool(updateData.active);
      const removeImage = toBool(updateData.removeImage) === true;
      delete updateData.removeImage;
      if (updateData.order) updateData.order = parseInt(updateData.order, 10);
      if (updateData.purchaseUnit === '') updateData.purchaseUnit = undefined;
      const currentArticle = await articleService.findById(id);
      if (!currentArticle) return res.status(404).json({ error: 'Artikel nicht gefunden' });

      // Bild entfernen (ohne neues Bild)
      const replaceImage = !!req.file || removeImage;
      if (removeImage && !req.file) {
        for (const key of IMAGE_FIELDS) updateData[key] = null;
      }

      // Neues Bild?
      if (req.file) {
        const imagePaths = await fileUploadService.processArticleImage(req.file);
        updateData.imageUrl = imagePaths.original;
        updateData.imageThumbnail = imagePaths.thumbnail;
        updateData.imageSmall = imagePaths.small;
        updateData.imageMedium = imagePaths.medium;
        updateData.imageLarge = imagePaths.large;
      }

      const article = await articleService.updateArticle(id, updateData, req.user.id);

      // Alte Bilddateien erst löschen, wenn die Datenbank nicht mehr auf sie zeigt (best-effort)
      if (replaceImage && currentArticle.imageUrl) {
        await fileUploadService.deleteArticleImages({
          original: currentArticle.imageUrl,
          thumbnail: currentArticle.imageThumbnail,
          small: currentArticle.imageSmall,
          medium: currentArticle.imageMedium,
          large: currentArticle.imageLarge,
        }).catch((err) => console.error('Alte Artikelbilder löschen fehlgeschlagen:', err));
      }

      // Audit
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_ARTICLE',
          entityType: 'Article',
          entityId: id,
          changes: updateData,
        },
      });

      res.json({ message: 'Artikel erfolgreich aktualisiert', article: sanitizeArticle(article) });
    } catch (error) {
      sendError(res, error, 'Fehler beim Aktualisieren des Artikels', 'Update article error:');
    }
  }

  // Aktivieren/Deaktivieren
  async toggleArticleStatus(req, res) {
    try {
      const { id } = req.params;
      const article = await articleService.toggleArticleStatus(id);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: article.active ? 'ACTIVATE_ARTICLE' : 'DEACTIVATE_ARTICLE',
          entityType: 'Article',
          entityId: id,
        },
      });

      res.json({
        message: `Artikel erfolgreich ${article.active ? 'aktiviert' : 'deaktiviert'}`,
        article: sanitizeArticle(article),
      });
    } catch (error) {
      sendError(res, error, 'Fehler beim Ändern des Artikelstatus', 'Toggle article status error:');
    }
  }

  // Bestandswarnung
  async checkLowStock(req, res) {
    try {
      const articles = (await articleService.checkLowStock()).map(sanitizeArticle);
      res.json({ articles, count: articles.length, hasWarnings: articles.length > 0 });
    } catch (error) {
      console.error('Check low stock error:', error);
      res.status(500).json({ error: 'Fehler beim Prüfen der Bestände' });
    }
  }

  // Statistiken
  async getArticleStats(req, res) {
    try {
      const { id } = req.params;
      const stats = await articleService.getArticleStats(id);
      if (!stats.article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
      res.json({ ...stats, article: sanitizeArticle(stats.article) });
    } catch (error) {
      console.error('Get article stats error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken' });
    }
  }

  async listCategories(req, res) {
    res.json(await articleService.categoryOverview());
  }

  async saveCategoryOrder(req, res) {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order muss eine Liste von Kategorienamen sein' });
    const overview = await articleService.saveCategoryOrder(order);
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'REORDER_CATEGORIES', entityType: 'Article', entityId: 'categories', changes: { tabs: overview.tabs } },
    });
    res.json(overview);
  }

  async renameCategory(req, res) {
    const { from, to } = req.body || {};
    try {
      const result = await articleService.renameCategory(from, to);
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'RENAME_CATEGORY', entityType: 'Article', entityId: String(from), changes: { from, to, ...result } },
      });
      res.json({ ...result, ...(await articleService.categoryOverview()) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async reorderArticles(req, res) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid data' });

      await articleService.reorderArticles(items);
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'REORDER_ARTICLES', entityType: 'Article', entityId: 'order', changes: { items } },
      });
      res.json({ message: 'Sortierung aktualisiert' });
    } catch (error) {
      console.error('Reorder articles error:', error);
      res.status(500).json({ error: 'Fehler beim Aktualisieren der Sortierung' });
    }
  }
}

module.exports = new ArticleController();
