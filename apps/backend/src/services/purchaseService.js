const prisma = require('../utils/prisma');

class PurchaseService {
  // Erstelle neuen Einkauf
  async createPurchase(data, userId) {
    const { items, ...purchaseData } = data;
    
    // Starte Transaktion
    const result = await prisma.$transaction(async (tx) => {
      // Erstelle Einkauf
      const purchase = await tx.purchase.create({
        data: {
          ...purchaseData,
          userId,
          items: {
            create: items.map(item => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              pricePerUnit: item.pricePerUnit,
              totalPrice: item.totalPrice,
              articleId: item.articleId
            }))
          }
        },
        include: {
          items: {
            include: {
              article: true
            }
          },
          user: {
            select: {
              name: true
            }
          }
        }
      });
      
      // Wenn bezahlt und Bar, dann von Kasse abbuchen
      if (purchase.paid && purchase.paymentMethod === 'CASH') {
        // Hier könnte man eine Kassenbestand-Tabelle führen
        // Für jetzt loggen wir es nur im Audit-Log
      }
      
      // Wenn Artikel verknüpft, Bestand erhöhen
      for (const item of items) {
        if (item.articleId) {
          await tx.article.update({
            where: { id: item.articleId },
            data: {
              stock: {
                increment: item.quantity
              }
            }
          });
          
          await tx.stockMovement.create({
            data: {
              articleId: item.articleId,
              type: 'DELIVERY',
              quantity: item.quantity,
              reason: `Einkauf ${purchase.invoiceNumber || purchase.id}`
            }
          });
        }
      }
      
      return purchase;
    });
    
    return result;
  }
  
  // Liste Einkäufe
 async listPurchases(filters = {}) {
  const { startDate, endDate, paid, search } = filters;
  const where = {};
  
  if (startDate || endDate) {
    where.invoiceDate = {};
    if (startDate) where.invoiceDate.gte = new Date(startDate);
    if (endDate) where.invoiceDate.lte = new Date(endDate);
  }
  
  if (paid !== undefined) {
    where.paid = paid === 'true';
  }
  
  if (search) {
    where.OR = [
      { supplier: { contains: search } },
      { invoiceNumber: { contains: search } },
      { description: { contains: search } }
    ];
  }
  
  return await prisma.purchase.findMany({
    where,
    include: {
      user: {
        select: {
          name: true
        }
      },
      _count: {
        select: {
          items: true
        }
      }
    },
    orderBy: { invoiceDate: 'desc' }
  });
}

  
  // Einzelner Einkauf
  async getPurchase(id) {
    return await prisma.purchase.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            article: true
          }
        },
        user: {
          select: {
            name: true
          }
        }
      }
    });
  }
  
  // Markiere als bezahlt
  async markAsPaid(id, paymentMethod, userId) {
    const purchase = await prisma.purchase.update({
      where: { id },
      data: {
        paid: true,
        paidAt: new Date(),
        paymentMethod
      }
    });
    
    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'MARK_PURCHASE_PAID',
        entityType: 'Purchase',
        entityId: id,
        changes: {
          paymentMethod,
          amount: purchase.totalAmount
        }
      }
    });
    
    return purchase;
  }
  
  // Berechne EÜR
  async calculateProfitLoss(startDate, endDate) {
  // Einnahmen aus Transaktionen (Bar & Kundenkonto)
  const transactionIncome = await prisma.transaction.aggregate({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate
      },
      cancelled: false,
      type: 'SALE'
    },
    _sum: {
      totalAmount: true
    }
  });
  
  // Einnahmen aus bezahlten Rechnungen
  const invoiceIncome = await prisma.invoice.aggregate({
    where: {
      paidAt: {
        gte: startDate,
        lte: endDate
      },
      status: 'PAID'
    },
    _sum: {
      totalAmount: true
    }
  });
  
  // Gesamteinnahmen
  const totalIncome = 
    (transactionIncome._sum.totalAmount || 0) + 
    (invoiceIncome._sum.totalAmount || 0);
  
  // Ausgaben
  const expenses = await prisma.purchase.aggregate({
    where: {
      invoiceDate: {
        gte: startDate,
        lte: endDate
      },
      paid: true
    },
    _sum: {
      totalAmount: true
    }
  });
  
  // Detaillierte Aufschlüsselung - Einnahmen nach Kategorie
  const incomeByCategory = await prisma.$queryRaw`
    SELECT 
      a.category,
      SUM(ti."totalPrice") as amount
    FROM "TransactionItem" ti
    JOIN "Transaction" t ON ti."transactionId" = t.id
    JOIN "Article" a ON ti."articleId" = a.id
    WHERE t."createdAt" >= ${startDate}
      AND t."createdAt" <= ${endDate}
      AND t.cancelled = false
      AND t.type = 'SALE'
    GROUP BY a.category
    
    UNION ALL
    
    SELECT 
      COALESCE(a.category, 'Sonstige') as category,
      SUM(ii."totalPrice") as amount
    FROM "InvoiceItem" ii
    JOIN "Invoice" i ON ii."invoiceId" = i.id
    LEFT JOIN "Article" a ON ii."articleId" = a.id
    WHERE i."paidAt" >= ${startDate}
      AND i."paidAt" <= ${endDate}
      AND i.status = 'PAID'
    GROUP BY a.category
  `;
  
  // Gruppiere nach Kategorie
  const categoryMap = {};
  incomeByCategory.forEach(item => {
    const category = item.category;
    if (!categoryMap[category]) {
      categoryMap[category] = 0;
    }
    categoryMap[category] += Number(item.amount);
  });
  
  const incomeByCategoryGrouped = Object.entries(categoryMap).map(([category, amount]) => ({
    category,
    amount
  }));
  
  const expensesBySupplier = await prisma.$queryRaw`
    SELECT 
      supplier,
      COUNT(*) as count,
      SUM("totalAmount") as amount
    FROM "Purchase"
    WHERE "invoiceDate" >= ${startDate}
      AND "invoiceDate" <= ${endDate}
      AND paid = true
    GROUP BY supplier
    ORDER BY amount DESC
  `;
  
  // Einnahmen nach Typ
  const incomeByType = {
    transactions: transactionIncome._sum.totalAmount || 0,
    invoices: invoiceIncome._sum.totalAmount || 0
  };
  
  return {
    period: {
      start: startDate,
      end: endDate
    },
    summary: {
      totalIncome,
      totalExpenses: expenses._sum.totalAmount || 0,
      profit: totalIncome - (expenses._sum.totalAmount || 0)
    },
    details: {
      incomeByCategory: incomeByCategoryGrouped,
      incomeByType,
      expensesBySupplier
    }
  };
}

}

module.exports = new PurchaseService();
