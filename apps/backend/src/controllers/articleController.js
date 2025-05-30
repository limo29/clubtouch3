const articleService = require('../services/articleService');
const fileUploadService = require('../services/fileUploadService');
const prisma = require('../utils/prisma');

class ArticleController {
  // Liste alle Artikel
  async listArticles(req, res) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const articles = await articleService.listArticles(includeInactive);
      
      res.json({
        articles,
        count: articles.length
      });
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
      
      if (!article) {
        return res.status(404).json({ error: 'Artikel nicht gefunden' });
      }
      
      res.json({ article });
    } catch (error) {
      console.error('Get article error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Artikels' });
    }
  }
  
  // Neuen Artikel erstellen
  async createArticle(req, res) {
  try {
    const articleData = req.body;
    
    // Wenn Bild hochgeladen wurde
    if (req.file) {
      const imagePaths = await fileUploadService.processArticleImage(req.file);
      articleData.imageUrl = imagePaths.original;
      articleData.imageThumbnail = imagePaths.thumbnail;
      articleData.imageSmall = imagePaths.small;
      articleData.imageMedium = imagePaths.medium;
      articleData.imageLarge = imagePaths.large;
    }
    
    const article = await articleService.createArticle(articleData);
    
    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_ARTICLE',
        entityType: 'Article',
        entityId: article.id,
        changes: articleData
      }
    });
    
    res.status(201).json({
      message: 'Artikel erfolgreich erstellt',
      article
    });
  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Artikels' });
  }
}


  
  // Artikel aktualisieren
  async updateArticle(req, res) {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Hole aktuellen Artikel für alte Bilder
    const currentArticle = await articleService.findById(id);
    
    // Wenn neues Bild hochgeladen wurde
    if (req.file) {
      const imagePaths = await fileUploadService.processArticleImage(req.file);
      updateData.imageUrl = imagePaths.original;
      updateData.imageThumbnail = imagePaths.thumbnail;
      updateData.imageSmall = imagePaths.small;
      updateData.imageMedium = imagePaths.medium;
      updateData.imageLarge = imagePaths.large;
      
      // Lösche alte Bilder
      if (currentArticle.imageUrl) {
        await fileUploadService.deleteArticleImages({
          original: currentArticle.imageUrl,
          thumbnail: currentArticle.imageThumbnail,
          small: currentArticle.imageSmall,
          medium: currentArticle.imageMedium,
          large: currentArticle.imageLarge
        });
      }
    }
    
    const article = await articleService.updateArticle(id, updateData);
    
    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_ARTICLE',
        entityType: 'Article',
        entityId: id,
        changes: updateData
      }
    });
    
    res.json({
      message: 'Artikel erfolgreich aktualisiert',
      article
    });
  } catch (error) {
    console.error('Update article error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Artikels' });
  }
}

  
  // Artikel aktivieren/deaktivieren
  async toggleArticleStatus(req, res) {
    try {
      const { id } = req.params;
      
      const article = await articleService.toggleArticleStatus(id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: article.active ? 'ACTIVATE_ARTICLE' : 'DEACTIVATE_ARTICLE',
          entityType: 'Article',
          entityId: id
        }
      });
      
      res.json({
        message: `Artikel erfolgreich ${article.active ? 'aktiviert' : 'deaktiviert'}`,
        article
      });
    } catch (error) {
      console.error('Toggle article status error:', error);
      res.status(500).json({ error: 'Fehler beim Ändern des Artikelstatus' });
    }
  }
  
  // Wareneingang
  async processDelivery(req, res) {
    try {
      const { id } = req.params;
      const { quantity, reason } = req.body;
      
      const article = await articleService.processDelivery(id, quantity, reason);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'ARTICLE_DELIVERY',
          entityType: 'Article',
          entityId: id,
          changes: { quantity, reason, newStock: article.stock }
        }
      });
      
      res.json({
        message: 'Wareneingang erfolgreich verbucht',
        article
      });
    } catch (error) {
      console.error('Process delivery error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Wareneingang' });
    }
  }
  
  // Inventur
  async processInventory(req, res) {
    try {
      const { id } = req.params;
      const { actualStock, reason } = req.body;
      
      const article = await articleService.processInventory(id, actualStock, reason);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'ARTICLE_INVENTORY',
          entityType: 'Article',
          entityId: id,
          changes: { actualStock, reason, newStock: article.stock }
        }
      });
      
      res.json({
        message: 'Inventur erfolgreich durchgeführt',
        article
      });
    } catch (error) {
      console.error('Process inventory error:', error);
      res.status(500).json({ error: error.message || 'Fehler bei der Inventur' });
    }
  }
  
  // Bestands-Warnung
  async checkLowStock(req, res) {
    try {
      const articles = await articleService.checkLowStock();
      
      res.json({
        articles,
        count: articles.length,
        hasWarnings: articles.length > 0
      });
    } catch (error) {
      console.error('Check low stock error:', error);
      res.status(500).json({ error: 'Fehler beim Prüfen der Bestände' });
    }
  }
  
  // Artikel-Statistiken
  async getArticleStats(req, res) {
    try {
      const { id } = req.params;
      const stats = await articleService.getArticleStats(id);
      
      if (!stats.article) {
        return res.status(404).json({ error: 'Artikel nicht gefunden' });
      }
      
      res.json(stats);
    } catch (error) {
      console.error('Get article stats error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken' });
    }
  }
}

module.exports = new ArticleController();
