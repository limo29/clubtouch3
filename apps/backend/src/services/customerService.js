const prisma = require('../utils/prisma');

class CustomerService {
  // Liste alle Kunden
  async listCustomers(search = '') {
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } }
      ]
    } : {};

    return await prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    });
  }

  // Finde Kunde by ID
  async findById(id) {
    return await prisma.customer.findUnique({
      where: { id },
      include: {
        accountTopUps: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                article: true
              }
            }
          }
        }
      }
    });
  }

  // Erstelle neuen Kunden
  async createCustomer(data) {
    // Prüfe ob Name bereits existiert
    const existing = await prisma.customer.findFirst({
      where: {
        name: data.name
      }
    });

    if (existing) {
      throw new Error('Ein Kunde mit diesem Namen existiert bereits');
    }

    // Aktualisiere lastActivity beim Erstellen
    return await prisma.customer.create({
      data: {
        name: data.name,
        nickname: data.nickname,
        gender: data.gender || 'OTHER',
        active: data.active !== undefined ? data.active : true, // Default true
        balance: 0,
        lastActivity: new Date()
      }
    });
  }


  // Update Kunde
  async updateCustomer(id, data) {
    // Prüfe ob neuer Name bereits existiert
    if (data.name) {
      const existing = await prisma.customer.findFirst({
        where: {
          name: data.name,
          NOT: { id }
        }
      });

      if (existing) {
        throw new Error('Ein anderer Kunde mit diesem Namen existiert bereits');
      }
    }

    return await prisma.customer.update({
      where: { id },
      data: {
        name: data.name,
        nickname: data.nickname,
        gender: data.gender,
        active: data.active,
        lastActivity: new Date()
      }
    });
  }


  // Guthaben aufladen
  async topUpAccount(customerId, amount, method, reference = null) {
    if (amount <= 0) {
      throw new Error('Betrag muss größer als 0 sein');
    }

    // Starte Transaktion
    const result = await prisma.$transaction(async (tx) => {
      // Erstelle Aufladung
      const topUp = await tx.accountTopUp.create({
        data: {
          customerId,
          amount,
          method,
          reference
        }
      });

      // Update Guthaben
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: {
          balance: {
            increment: amount
          }
        }
      });

      return { topUp, customer };
    });

    return result;
  }

  // Guthaben abbuchen (für Verkäufe)
  async deductBalance(customerId, amount) {
    if (amount <= 0) {
      throw new Error('Betrag muss größer als 0 sein');
    }

    // Hole aktuellen Kunden
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new Error('Kunde nicht gefunden');
    }

    // Prüfe Guthaben
    if (customer.balance < amount) {
      throw new Error(`Nicht genügend Guthaben. Verfügbar: €${customer.balance}, Benötigt: €${amount}`);
    }

    // Update Guthaben
    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        balance: {
          decrement: amount
        }
      }
    });
  }

  // Guthaben zurückbuchen (bei Storno)
  async refundBalance(customerId, amount) {
    if (amount <= 0) {
      throw new Error('Betrag muss größer als 0 sein');
    }

    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        balance: {
          increment: amount
        }
      }
    });
  }

  // Kunden-Statistiken
  async getCustomerStats(customerId) {
    const [customer, totalSpent, transactionCount, favoriteArticles] = await Promise.all([
      // Basis-Kundendaten
      prisma.customer.findUnique({ where: { id: customerId } }),

      // Gesamtausgaben
      prisma.transaction.aggregate({
        where: {
          customerId,
          cancelled: false
        },
        _sum: {
          totalAmount: true
        }
      }),

      // Anzahl Transaktionen
      prisma.transaction.count({
        where: {
          customerId,
          cancelled: false
        }
      }),

      // Lieblingsartikel (Top 5)
      prisma.$queryRaw`
        SELECT 
          a.id,
          a.name,
          a.category,
          SUM(ti.quantity) as total_quantity,
          SUM(ti."totalPrice") as total_spent
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId}
          AND t.cancelled = false
        GROUP BY a.id, a.name, a.category
        ORDER BY total_quantity DESC
        LIMIT 5
      `
    ]);

    return {
      customer,
      totalSpent: totalSpent._sum.totalAmount || 0,
      transactionCount,
      favoriteArticles
    };
  }

  // Kunden mit niedrigem Guthaben
  async getCustomersWithLowBalance(threshold = 5) {
    return await prisma.customer.findMany({
      where: {
        balance: {
          lt: threshold,
          gt: 0
        }
      },
      orderBy: { balance: 'asc' }
    });
  }

  // Kunden mit negativem Guthaben (sollte nicht vorkommen)
  async getCustomersWithNegativeBalance() {
    return await prisma.customer.findMany({
      where: {
        balance: {
          lt: 0
        }
      },
      orderBy: { balance: 'asc' }
    });
  }

  // Kontoauszug
  async getAccountStatement(customerId, startDate, endDate) {
    const customer = await this.findById(customerId);
    if (!customer) {
      throw new Error('Kunde nicht gefunden');
    }

    // Hole alle relevanten Bewegungen im Zeitraum
    const [topUps, transactions] = await Promise.all([
      prisma.accountTopUp.findMany({
        where: {
          customerId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        orderBy: { createdAt: 'asc' }
      }),

      prisma.transaction.findMany({
        where: {
          customerId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          items: {
            include: {
              article: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      })
    ]);

    // Kombiniere und sortiere alle Bewegungen
    const movements = [];

    // Aufladungen
    topUps.forEach(topUp => {
      movements.push({
        date: topUp.createdAt,
        type: 'TOPUP',
        description: `Aufladung (${topUp.method})`,
        amount: topUp.amount,
        balance: 0 // Wird später berechnet
      });
    });

    // Transaktionen
    transactions.forEach(transaction => {
      const description = transaction.cancelled ? '[STORNIERT] ' : '';
      const amount = transaction.cancelled ? 0 : -transaction.totalAmount;

      movements.push({
        date: transaction.createdAt,
        type: transaction.cancelled ? 'CANCELLED' : 'PURCHASE',
        description: description + `Einkauf (${transaction.items.length} Artikel)`,
        amount: amount,
        balance: 0 // Wird später berechnet
      });
    });

    // Sortiere nach Datum
    movements.sort((a, b) => a.date - b.date);

    // Berechne laufenden Saldo
    let runningBalance = customer.balance;
    for (let i = movements.length - 1; i >= 0; i--) {
      movements[i].balance = runningBalance;
      runningBalance -= movements[i].amount;
    }

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        nickname: customer.nickname,
        currentBalance: customer.balance
      },
      startDate,
      endDate,
      movements,
      summary: {
        totalTopUps: topUps.reduce((sum, t) => sum + Number(t.amount), 0),
        totalSpent: transactions
          .filter(t => !t.cancelled)
          .reduce((sum, t) => sum + Number(t.totalAmount), 0),
        transactionCount: transactions.filter(t => !t.cancelled).length
      }
    };
  }
  // Kombinierte Historie (Transaktionen + Aufladungen)
  async getHistory(customerId, limit = 50) {
    const [transactions, topUps] = await Promise.all([
      prisma.transaction.findMany({
        where: { customerId },
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { article: true } } }
      }),
      prisma.accountTopUp.findMany({
        where: { customerId },
        take: limit,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Kombinieren und Sortieren
    const combined = [
      ...transactions.map(t => ({
        type: 'TRANSACTION',
        id: t.id,
        date: t.createdAt,
        amount: t.cancelled ? 0 : -Number(t.totalAmount), // Ausgaben sind negativ
        originalAmount: Number(t.totalAmount),
        method: t.paymentMethod,
        items: t.items,
        cancelled: t.cancelled,
        cancelledAt: t.cancelledAt
      })),
      ...topUps.map(t => ({
        type: 'TOPUP',
        id: t.id,
        date: t.createdAt,
        amount: Number(t.amount), // Einzahlungen sind positiv
        method: t.method,
        reference: t.reference
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return combined.slice(0, limit);
  }

  // Aufladung stornieren (Gegenbuchung)
  async reverseTopUp(topUpId, userId) {
    return await prisma.$transaction(async (tx) => {
      const original = await tx.accountTopUp.findUnique({ where: { id: topUpId } });
      if (!original) throw new Error('Aufladung nicht gefunden');

      // Prüfen ob schon storniert (indem wir schauen ob es eine Gegenbuchung mit dieser Referenz gibt)
      // Wir nutzen das "reference" Feld um die ID der Originalbuchung zu speichern
      const alreadyReversed = await tx.accountTopUp.findFirst({
        where: {
          reference: `STORNO:${topUpId}`
        }
      });

      if (alreadyReversed) throw new Error('Diese Aufladung wurde bereits storniert');

      // Gegenbuchung erstellen
      const reversal = await tx.accountTopUp.create({
        data: {
          customerId: original.customerId,
          amount: -Number(original.amount),
          method: original.method,
          reference: `STORNO:${topUpId}`
        }
      });

      // Guthaben aktualisieren
      await tx.customer.update({
        where: { id: original.customerId },
        data: { balance: { decrement: original.amount } }
      });

      return reversal;
    });
  }
}

module.exports = new CustomerService();
