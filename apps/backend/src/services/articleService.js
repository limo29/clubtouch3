const prisma = require('../utils/prisma');

class ArticleService {
  // Liste alle Artikel
  async listArticles(includeInactive = false) {
    const where = includeInactive ? {} : { active: true };
    
    return await prisma.article.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ]
    });
  }
  
  // Finde Artikel by ID
  async findById(id) {
    return await prisma.article.findUnique({
      where: { id },
      include: {
        stockMovements: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }
  
  // Erstelle neuen Artikel
  async createArticle(data) {
    const article = await prisma.article.create({
      data: {
        name: data.name,
        price: data.price,
        stock: data.initialStock || 0,
        minStock: data.minStock || 0,
        unit: data.unit || 'Stück',
        category: data.category,
        imageUrl: data.imageUrl,
        countsForHighscore: data.countsForHighscore !== false
      }
    });
    
    // Wenn Initial-Bestand > 0, erstelle Bestandsbewegung
    if (data.initialStock > 0) {
      await prisma.stockMovement.create({
        data: {
          articleId: article.id,
          type: 'INVENTORY',
          quantity: data.initialStock,
          reason: 'Initial-Bestand'
        }
      });
    }
    
    return article;
  }
  
  // Update Artikel
  async updateArticle(id, data) {
    // Entferne Felder die nicht direkt upgedated werden sollen
    const { stockAdjustment, adjustmentReason, ...updateData } = data;
    
    const article = await prisma.article.update({
      where: { id },
      data: updateData
    });
    
    // Handle Bestandsanpassung wenn gewünscht
    if (stockAdjustment && stockAdjustment !== 0) {
      await this.adjustStock(id, stockAdjustment, adjustmentReason || 'Manuelle Anpassung');
    }
    
    return article;
  }
  
  // Aktiviere/Deaktiviere Artikel
  async toggleArticleStatus(id) {
    const article = await prisma.article.findUnique({ where: { id } });
    
    if (!article) {
      throw new Error('Artikel nicht gefunden');
    }
    
    return await prisma.article.update({
      where: { id },
      data: { active: !article.active }
    });
  }
  
  // Bestand anpassen
  async adjustStock(articleId, quantity, reason, type = 'CORRECTION') {
    // Hole aktuellen Artikel
    const article = await prisma.article.findUnique({
      where: { id: articleId }
    });
    
    if (!article) {
      throw new Error('Artikel nicht gefunden');
    }
    
    // Prüfe ob neuer Bestand negativ würde
    const newStock = article.stock + quantity;
    if (newStock < 0) {
      throw new Error(`Bestand kann nicht negativ werden. Aktuell: ${article.stock}, Änderung: ${quantity}`);
    }
    
    // Update Bestand
    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: { stock: newStock }
    });
    
    // Erstelle Bestandsbewegung
    await prisma.stockMovement.create({
      data: {
        articleId,
        type,
        quantity,
        reason
      }
    });
    
    return updatedArticle;
  }
  
  // Wareneingang
  async processDelivery(articleId, quantity, reason = 'Wareneingang') {
    if (quantity <= 0) {
      throw new Error('Menge muss größer als 0 sein');
    }
    
    return await this.adjustStock(articleId, quantity, reason, 'DELIVERY');
  }
  
  // Inventur
  async processInventory(articleId, actualStock, reason = 'Inventur') {
    const article = await prisma.article.findUnique({
      where: { id: articleId }
    });
    
    if (!article) {
      throw new Error('Artikel nicht gefunden');
    }
    
    const difference = actualStock - article.stock;
    
    if (difference === 0) {
      return article; // Keine Änderung nötig
    }
    
    return await this.adjustStock(articleId, difference, reason, 'INVENTORY');
  }
  
  // Prüfe kritische Bestände
  async checkLowStock() {
    return await prisma.article.findMany({
      where: {
        active: true,
        stock: {
          lte: prisma.article.fields.minStock
        }
      },
      orderBy: {
        stock: 'asc'
      }
    });
  }
  
  // Artikel-Statistiken
  async getArticleStats(articleId) {
    const [article, salesCount, totalRevenue] = await Promise.all([
      prisma.article.findUnique({ where: { id: articleId } }),
      
      // Anzahl Verkäufe
      prisma.transactionItem.count({
        where: {
          articleId,
          transaction: {
            cancelled: false
          }
        }
      }),
      
      // Gesamtumsatz
      prisma.transactionItem.aggregate({
        where: {
          articleId,
          transaction: {
            cancelled: false
          }
        },
        _sum: {
          totalPrice: true
        }
      })
    ]);
    
    return {
      article,
      salesCount,
      totalRevenue: totalRevenue._sum.totalPrice || 0
    };
  }
}

module.exports = new ArticleService();
