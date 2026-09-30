const { hashPassword, comparePassword } = require('../utils/auth');
const prisma = require('../utils/prisma');

const PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true
};

/** E-Mail normalisieren: getrimmt und klein (Login und Eindeutigkeit sind unabhängig von der Schreibweise) */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

/** Benutzername: getrimmt, Schreibweise bleibt wie eingegeben; leer → null (unique erlaubt mehrere null) */
function normalizeUsername(username) {
  if (username === undefined) return undefined;
  if (username === null) return null;
  const trimmed = String(username).trim();
  return trimmed === '' ? null : trimmed;
}

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class UserService {
  /** Gibt es schon einen anderen Benutzer mit dieser E-Mail / diesem Benutzernamen (ohne Groß-/Kleinschreibung)? */
  async _assertUnique({ email, username }, excludeId = null) {
    if (email) {
      const byEmail = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true }
      });
      if (byEmail) throw new UserError('Benutzer mit dieser E-Mail existiert bereits');
    }
    if (username) {
      const byUsername = await prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true }
      });
      if (byUsername) throw new UserError('Benutzername bereits vergeben');
    }
  }

  // Erstelle neuen User
  async createUser(data) {
    const email = normalizeEmail(data.email);
    const username = normalizeUsername(data.username);
    const { password, name, role = 'CASHIER' } = data;

    await this._assertUnique({ email, username });

    const hashedPassword = await hashPassword(password);

    return prisma.user.create({
      data: { email, username, password: hashedPassword, name: String(name).trim(), role },
      select: PUBLIC_SELECT
    });
  }

  // Finde User by Email (inkl. Passwort-Hash, nur für Login)
  async findByEmail(email) {
    return prisma.user.findFirst({
      where: { email: { equals: normalizeEmail(email), mode: 'insensitive' } }
    });
  }

  // Finde User by Username oder Email, Groß-/Kleinschreibung egal (inkl. Passwort-Hash, nur für Login)
  async findByIdentifier(identifier) {
    const id = String(identifier || '').trim();
    if (!id) return null;
    if (id.includes('@')) return this.findByEmail(id);
    return prisma.user.findFirst({
      where: { username: { equals: id, mode: 'insensitive' } }
    });
  }

  // Finde User by ID
  async findById(id) {
    return prisma.user.findUnique({ where: { id }, select: PUBLIC_SELECT });
  }

  // Liste alle User
  async listUsers() {
    return prisma.user.findMany({ select: PUBLIC_SELECT, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  // Update User (nur erlaubte Felder; Passwort wird gehasht)
  async updateUser(id, input) {
    const data = {};
    if (input.name !== undefined) data.name = String(input.name).trim();
    if (input.email !== undefined) data.email = normalizeEmail(input.email);
    if (input.username !== undefined) data.username = normalizeUsername(input.username);
    if (input.role !== undefined) data.role = input.role;
    if (input.password) data.password = await hashPassword(input.password);

    await this._assertUnique({ email: data.email, username: data.username }, id);

    return prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  }

  /**
   * Eigenes Passwort ändern: altes Passwort muss stimmen. Andere Sessions des Benutzers
   * werden beendet (nur die aktuelle bleibt), damit ein abhanden gekommenes Gerät rausfliegt.
   */
  async changeOwnPassword(userId, { currentPassword, newPassword, keepToken }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserError('Benutzer nicht gefunden', 404);

    const ok = await comparePassword(currentPassword, user.password);
    if (!ok) throw new UserError('Das aktuelle Passwort ist falsch');
    if (await comparePassword(newPassword, user.password)) {
      throw new UserError('Das neue Passwort muss sich vom bisherigen unterscheiden');
    }

    const hashed = await hashPassword(newPassword);
    const [, removed] = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { password: hashed } }),
      prisma.session.deleteMany({ where: { userId, ...(keepToken ? { NOT: { token: keepToken } } : {}) } })
    ]);
    return { closedSessions: removed.count };
  }

  // Aktiviere/Deaktiviere User
  async toggleUserStatus(id) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new UserError('Benutzer nicht gefunden', 404);

    const updated = await prisma.user.update({
      where: { id },
      data: { active: !user.active },
      select: { id: true, active: true }
    });
    // Deaktivierte Benutzer sofort abmelden
    if (!updated.active) await prisma.session.deleteMany({ where: { userId: id } });
    return updated;
  }
}

module.exports = new UserService();
module.exports.UserError = UserError;
