const articleService = require('../services/articleService');
const fileUploadService = require('../services/fileUploadService');
const prisma = require('../utils/prisma');

// Prisma Decimal mag Strings -> kleine Helper
const toDecimalString = (v) =>
  v === undefined || v === null || v === '' ? undefined : String(v).replace(',', '.');

class ArticleController {
  // Liste alle Artikel
  async listArticles(req, res) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const articles = await articleService.listArticles(includeInactive);
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
      res.json({ article });
    } catch (error) {
      console.error('Get article error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Artikels' });
    }
  }

  // Neuen Artikel erstellen
  async createArticle(req, res) {
    console.log('[articles] req.file?', !!req.file, req.headers['content-type']);

    try {
      const articleData = { ...req.body };

      // Zahlen normalisieren
      articleData.price = toDecimalString(articleData.price);
      articleData.initialStock = toDecimalString(articleData.initialStock);
      articleData.minStock = toDecimalString(articleData.minStock);

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

      res.status(201).json({ message: 'Artikel erfolgreich erstellt', article });
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
      const updateData = { ...req.body };

      // Zahlen normalisieren
      updateData.price = toDecimalString(updateData.price);
      updateData.minStock = toDecimalString(updateData.minStock);

      const currentArticle = await articleService.findById(id);
      if (!currentArticle) return res.status(404).json({ error: 'Artikel nicht gefunden' });

      // Neues Bild?
      if (req.file) {
        const imagePaths = await fileUploadService.processArticleImage(req.file);
        updateData.imageUrl = imagePaths.original;
        updateData.imageThumbnail = imagePaths.thumbnail;
        updateData.imageSmall = imagePaths.small;
        updateData.imageMedium = imagePaths.medium;
        updateData.imageLarge = imagePaths.large;

        // Alte Bilder löschen (best-effort)
        await fileUploadService.deleteArticleImages({
          original: currentArticle.imageUrl,
          thumbnail: currentArticle.imageThumbnail,
          small: currentArticle.imageSmall,
          medium: currentArticle.imageMedium,
          large: currentArticle.imageLarge,
        });
      }

      const article = await articleService.updateArticle(id, updateData);

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

      res.json({ message: 'Artikel erfolgreich aktualisiert', article });
    } catch (error) {
      console.error('Update article error:', error);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Artikels' });
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
        article,
      });
    } catch (error) {
      console.error('Toggle article status error:', error);
      res.status(500).json({ error: 'Fehler beim Ändern des Artikelstatus' });
    }
  }

  // Bestandswarnung
  async checkLowStock(req, res) {
    try {
      const articles = await articleService.checkLowStock();
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
      res.json(stats);
    } catch (error) {
      console.error('Get article stats error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken' });
    }
  }
}

module.exports = new ArticleController();
