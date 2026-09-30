const userService = require('../services/userService');
const prisma = require('../utils/prisma');

class UserController {
  // Liste alle User
  async listUsers(req, res) {
    try {
      const users = await userService.listUsers();
      
      res.json({
        users,
        count: users.length
      });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Benutzer' });
    }
  }
  
  // Einzelnen User abrufen
  async getUser(req, res) {
    try {
      const { id } = req.params;
      const user = await userService.findById(id);
      
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      
      res.json({ user });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Benutzers' });
    }
  }
  
  // Neuen User erstellen
  async createUser(req, res) {
    try {
      const { email, username, password, name, role } = req.body;
      
      // Nur Admins dürfen andere Admins erstellen
      if (role === 'ADMIN' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ 
          error: 'Nur Administratoren können Admin-Benutzer erstellen' 
        });
      }
      
      const user = await userService.createUser({
        email,
        username,
        password,
        name,
        role
      });
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_USER',
          entityType: 'User',
          entityId: user.id,
          changes: {
            email: user.email,
            username: user.username,
            name: user.name,
            role: user.role
          }
        }
      });
      
      res.status(201).json({
        message: 'Benutzer erfolgreich erstellt',
        user
      });
    } catch (error) {
      console.error('Create user error:', error);
      
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'E-Mail oder Benutzername bereits vergeben' });
      }
      
      res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
    }
  }
  
  // User aktualisieren
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      // Nur bekannte Felder übernehmen (kein active/id/… über diesen Weg)
      const updateData = {};
      for (const key of ['name', 'email', 'username', 'role', 'password']) {
        if (req.body[key] !== undefined) updateData[key] = req.body[key];
      }
      
      // Prüfe ob User existiert
      const existingUser = await userService.findById(id);
      if (!existingUser) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      
      // Nur Admins dürfen Rollen ändern
      if (updateData.role && req.user.role !== 'ADMIN') {
        delete updateData.role;
      }
      
      // Verhindere dass der letzte Admin sich selbst die Admin-Rolle entziehen kann
      if (existingUser.role === 'ADMIN' && updateData.role && updateData.role !== 'ADMIN') {
        const adminCount = await prisma.user.count({
          where: { role: 'ADMIN', active: true }
        });
        
        if (adminCount <= 1) {
          return res.status(400).json({ 
            error: 'Der letzte Administrator kann nicht herabgestuft werden' 
          });
        }
      }
      
      const user = await userService.updateUser(id, updateData);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_USER',
          entityType: 'User',
          entityId: id,
          changes: { ...updateData, ...(updateData.password ? { password: '(geändert)' } : {}) }
        }
      });
      
      res.json({
        message: updateData.password ? 'Benutzer aktualisiert, neues Passwort gesetzt' : 'Benutzer erfolgreich aktualisiert',
        passwordChanged: Boolean(updateData.password),
        user
      });
    } catch (error) {
      console.error('Update user error:', error);
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'E-Mail oder Benutzername bereits vergeben' });
      }
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Benutzers' });
    }
  }
  
  // User aktivieren/deaktivieren
  async toggleUserStatus(req, res) {
    try {
      const { id } = req.params;
      
      // Verhindere Selbst-Deaktivierung
      if (id === req.user.id) {
        return res.status(400).json({ 
          error: 'Sie können sich nicht selbst deaktivieren' 
        });
      }
      
      // Prüfe ob es der letzte aktive Admin ist
      const user = await userService.findById(id);
      if (user && user.role === 'ADMIN' && user.active) {
        const activeAdminCount = await prisma.user.count({
          where: { role: 'ADMIN', active: true }
        });
        
        if (activeAdminCount <= 1) {
          return res.status(400).json({ 
            error: 'Der letzte aktive Administrator kann nicht deaktiviert werden' 
          });
        }
      }
      
      const result = await userService.toggleUserStatus(id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: result.active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
          entityType: 'User',
          entityId: id
        }
      });
      
      res.json({
        message: `Benutzer erfolgreich ${result.active ? 'aktiviert' : 'deaktiviert'}`,
        user: result
      });
    } catch (error) {
      console.error('Toggle user status error:', error);
      res.status(500).json({ error: 'Fehler beim Ändern des Benutzerstatus' });
    }
  }
  
  // Benutzer löschen (nur deaktivieren, kein hard delete)
  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      
      // Verhindere Selbst-Löschung
      if (id === req.user.id) {
        return res.status(400).json({ 
          error: 'Sie können sich nicht selbst löschen' 
        });
      }
      
      // Deaktiviere statt löschen
      await this.toggleUserStatus(req, res);
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Fehler beim Löschen des Benutzers' });
    }
  }
}

module.exports = new UserController();
