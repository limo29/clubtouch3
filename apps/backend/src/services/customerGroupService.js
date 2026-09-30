// services/customerGroupService.js
const prisma = require('../utils/prisma');

// Gruppenfelder für Include-Abfragen (Kurzform, ohne Kunden-Liste)
const GROUP_SELECT = {
  id: true,
  name: true,
  color: true,
  emoji: true,
  imageUrl: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
};

class CustomerGroupService {
  /**
   * Alle Gruppen mit Mitgliederzahl.
   * @param {boolean} includeInactive - auch inaktive Gruppen zurückgeben
   */
  async listGroups(includeInactive = false) {
    const where = includeInactive ? {} : { active: true };
    const groups = await prisma.customerGroup.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { customers: true } },
      },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      emoji: g.emoji,
      imageUrl: g.imageUrl,
      active: g.active,
      sortOrder: g.sortOrder,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      memberCount: g._count.customers,
    }));
  }

  /**
   * Eine Gruppe nach ID laden (mit memberCount).
   */
  async findById(id) {
    const g = await prisma.customerGroup.findUnique({
      where: { id },
      include: { _count: { select: { customers: true } } },
    });
    if (!g) return null;
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      emoji: g.emoji,
      imageUrl: g.imageUrl,
      active: g.active,
      sortOrder: g.sortOrder,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      memberCount: g._count.customers,
    };
  }

  /**
   * Neue Gruppe anlegen.
   * Wirft Error bei doppeltem Namen (Groß-/Kleinschreibung ignoriert).
   */
  async createGroup(data) {
    const existing = await prisma.customerGroup.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (existing) {
      throw Object.assign(new Error('Eine Gruppe mit diesem Namen existiert bereits'), { code: 'NAME_TAKEN' });
    }
    return prisma.customerGroup.create({
      data: {
        name: data.name,
        color: data.color || '#1976d2',
        emoji: data.emoji || null,
        sortOrder: data.sortOrder !== undefined ? Number(data.sortOrder) : 0,
        active: data.active !== undefined ? Boolean(data.active) : true,
      },
    });
  }

  /**
   * Gruppe aktualisieren.
   */
  async updateGroup(id, data) {
    // Prüfe ob neuer Name bereits vergeben ist (Groß-/Kleinschreibung egal)
    if (data.name !== undefined) {
      const existing = await prisma.customerGroup.findFirst({
        where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id } },
      });
      if (existing) {
        throw Object.assign(new Error('Eine andere Gruppe mit diesem Namen existiert bereits'), { code: 'NAME_TAKEN' });
      }
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.color !== undefined) updateData.color = data.color;
    if (Object.prototype.hasOwnProperty.call(data, 'emoji')) updateData.emoji = data.emoji || null;
    if (data.sortOrder !== undefined) updateData.sortOrder = Number(data.sortOrder);
    if (data.active !== undefined) updateData.active = Boolean(data.active);
    if (Object.prototype.hasOwnProperty.call(data, 'imageUrl')) updateData.imageUrl = data.imageUrl || null;

    return prisma.customerGroup.update({ where: { id }, data: updateData });
  }

  /**
   * Gruppe löschen. Kunden verlieren die Gruppe (SetNull via FK).
   */
  async deleteGroup(id) {
    return prisma.customerGroup.delete({ where: { id } });
  }
}

module.exports = new CustomerGroupService();
