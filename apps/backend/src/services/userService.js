
const { hashPassword } = require('../utils/auth');

// Erstelle eine eigene Prisma-Instanz für den Service
const prisma = require('../utils/prisma');

class UserService {
  // Erstelle neuen User
  async createUser(data) {
    const { email, password, name, role = 'CASHIER' } = data;

    // Prüfe ob User bereits existiert
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw new Error('Benutzer mit dieser E-Mail existiert bereits');
    }

    // Prüfe ob Username existiert (falls angegeben)
    if (data.username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username: data.username }
      });

      if (existingUsername) {
        throw new Error('Benutzername bereits vergeben');
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Erstelle User
    const user = await prisma.user.create({
      data: {
        email,
        username: data.username,
        password: hashedPassword,
        name,
        role
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        active: true,
        createdAt: true
      }
    });

    return user;
  }

  // Finde User by Email
  async findByEmail(email) {
    return await prisma.user.findUnique({
      where: { email }
    });
  }

  // Finde User by Username oder Email
  async findByIdentifier(identifier) {
    // Wenn es wie eine Email aussieht
    if (identifier.includes('@')) {
      return await this.findByEmail(identifier);
    }

    // Sonst suche nach Username
    return await prisma.user.findUnique({
      where: { username: identifier }
    });
  }

  // Finde User by ID
  async findById(id) {
    return await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        username: true
      }
    });
  }

  // Liste alle User
  async listUsers() {
    return await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        username: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // Update User
  async updateUser(id, data) {
    // Wenn Passwort geändert wird, hashen
    if (data.password) {
      data.password = await hashPassword(data.password);
    }

    return await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        updatedAt: true,
        username: true
      }
    });
  }

  // Aktiviere/Deaktiviere User
  async toggleUserStatus(id) {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new Error('Benutzer nicht gefunden');
    }

    return await prisma.user.update({
      where: { id },
      data: { active: !user.active },
      select: {
        id: true,
        active: true
      }
    });
  }
}

module.exports = new UserService();
