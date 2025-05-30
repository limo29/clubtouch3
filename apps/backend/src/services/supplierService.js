const prisma = require('../utils/prisma');

class SupplierService {
  // Hole alle eindeutigen Lieferanten
  async getUniqueSuppliers() {
    const suppliers = await prisma.purchase.findMany({
      select: {
        supplier: true
      },
      distinct: ['supplier'],
      orderBy: {
        supplier: 'asc'
      }
    });
    
    return suppliers.map(s => s.supplier);
  }
}

module.exports = new SupplierService();
