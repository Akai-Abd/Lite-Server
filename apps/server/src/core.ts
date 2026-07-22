import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import type { User, AuditLog } from './shared.js'
import { createAuthService, type AuthService } from './auth.js'
import { createVFS, type VFS } from './vfs.js'
import { mkdirSync } from 'fs'

export interface CoreConfig {
  dataDir: string
  logLevel?: string
}

export class Core {
  private db: Database.Database
  public auth: AuthService
  public vfs: VFS

  constructor(config: CoreConfig) {
    // Ensure data directory exists
    mkdirSync(config.dataDir, { recursive: true })
    this.db = new Database(`${config.dataDir}/lite-server.db`)
    this.auth = createAuthService()
    this.vfs = createVFS()
  }

  async initialize(): Promise<void> {
    this.initializeDatabase()
    await this.vfs.initialize()
    console.log('[Core] Initialized successfully')
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        mfa_enabled INTEGER DEFAULT 0,
        mfa_secret TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_groups (
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        PRIMARY KEY (user_id, group_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mounts (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        driver TEXT NOT NULL,
        config TEXT NOT NULL,
        base_path TEXT NOT NULL,
        read_only INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS file_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        parent_id TEXT,
        mount_id TEXT NOT NULL,
        virtual_path TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT,
        checksum TEXT,
        hidden INTEGER DEFAULT 0,
        read_only INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (mount_id) REFERENCES mounts(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES file_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        virtual_path TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        password TEXT,
        expires_at TEXT,
        max_downloads INTEGER,
        download_count INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        metadata TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS trash_items (
        id TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        deleted_by TEXT NOT NULL,
        deleted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_levels (
        id TEXT PRIMARY KEY,
        file_entry_id TEXT,
        virtual_path TEXT,
        user_id TEXT,
        group_id TEXT,
        permissions TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_quotas (
        user_id TEXT PRIMARY KEY,
        quota_bytes INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_file_entries_virtual_path ON file_entries(virtual_path);
      CREATE INDEX IF NOT EXISTS idx_file_entries_parent_id ON file_entries(parent_id);
      CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `)

    const sharesCols = this.db.prepare("PRAGMA table_info(shares)").all() as any[]
    if (sharesCols.length > 0 && sharesCols.some(col => col.name === 'file_entry_id')) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE shares_new (
          id TEXT PRIMARY KEY,
          virtual_path TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          password TEXT,
          expires_at TEXT,
          max_downloads INTEGER,
          download_count INTEGER DEFAULT 0,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO shares_new (id, virtual_path, token, password, expires_at, max_downloads, download_count, created_by, created_at)
        SELECT id, COALESCE(virtual_path, ''), token, password, expires_at, max_downloads, download_count, created_by, created_at FROM shares;
        DROP TABLE shares;
        ALTER TABLE shares_new RENAME TO shares;
        CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
        PRAGMA foreign_keys = ON;
      `)
    } else if (sharesCols.length > 0 && !sharesCols.some(col => col.name === 'virtual_path')) {
      this.db.prepare("ALTER TABLE shares ADD COLUMN virtual_path TEXT NOT NULL DEFAULT ''").run()
    }
  }

  // ─── User Management ──────────────────────────────────────────────────────

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const updatedAt = createdAt

    this.db.prepare(`
      INSERT INTO users (id, username, email, role, password_hash, mfa_enabled, mfa_secret, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.username,
      user.email,
      user.role,
      user.passwordHash,
      user.mfaEnabled ? 1 : 0,
      user.mfaSecret || null,
      createdAt,
      updatedAt
    )

    return {
      id,
      ...user,
      createdAt,
      updatedAt,
    }
  }

  getUserByUsername(username: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any
    if (!row) return null
    return this.mapRowToUser(row)
  }

  getUserById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapRowToUser(row)
  }

  getAllUsers(): User[] {
    const rows = this.db.prepare('SELECT * FROM users').all() as any[]
    return rows.map(row => this.mapRowToUser(row))
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return result.changes > 0
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<boolean> {
    const updatedAt = new Date().toISOString()
    const result = this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, updatedAt, id)
    return result.changes > 0
  }

  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      passwordHash: row.password_hash,
      mfaEnabled: Boolean(row.mfa_enabled),
      mfaSecret: row.mfa_secret || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // ─── Audit Logging ────────────────────────────────────────────────────────

  async logAudit(log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, resource, resource_id, metadata, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      log.userId || null,
      log.action,
      log.resource || null,
      log.resourceId || null,
      JSON.stringify(log.metadata || {}),
      log.ipAddress || null,
      log.userAgent || null,
      createdAt
    )
  }

  getAuditLogs(limit: number = 100): AuditLog[] {
    const rows = this.db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit) as any[]
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }))
  }

  // ─── Trash Management ─────────────────────────────────────────────────────

  addTrashItem(item: { originalPath: string; trashPath: string; deletedBy: string }): any {
    const id = crypto.randomUUID()
    const deletedAt = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO trash_items (id, original_path, trash_path, deleted_by, deleted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, item.originalPath, item.trashPath, item.deletedBy, deletedAt)
    return { id, ...item, deletedAt }
  }

  getTrashItems(): any[] {
    return this.db.prepare('SELECT * FROM trash_items ORDER BY deleted_at DESC').all()
  }

  getTrashItemById(id: string): any {
    return this.db.prepare('SELECT * FROM trash_items WHERE id = ?').get(id)
  }

  removeTrashItem(id: string): boolean {
    const result = this.db.prepare('DELETE FROM trash_items WHERE id = ?').run(id)
    return result.changes > 0
  }

  clearTrash(): any[] {
    const items = this.getTrashItems()
    this.db.prepare('DELETE FROM trash_items').run()
    return items
  }

  // ─── Share Management ─────────────────────────────────────────────────────

  createShare(share: { virtualPath: string; token: string; password?: string; expiresAt?: string; maxDownloads?: number; createdBy: string }): any {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO shares (id, virtual_path, token, password, expires_at, max_downloads, download_count, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      share.virtualPath,
      share.token,
      share.password || null,
      share.expiresAt || null,
      share.maxDownloads || null,
      share.createdBy,
      createdAt
    )
    return { id, ...share, downloadCount: 0, createdAt }
  }

  getShareByToken(token: string): any {
    return this.db.prepare('SELECT * FROM shares WHERE token = ?').get(token)
  }

  getAllShares(): any[] {
    return this.db.prepare('SELECT * FROM shares ORDER BY created_at DESC').all()
  }

  deleteShare(id: string): boolean {
    const result = this.db.prepare('DELETE FROM shares WHERE id = ?').run(id)
    return result.changes > 0
  }

  incrementShareDownload(id: string): void {
    this.db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(id)
  }

  // ─── Quota Management ─────────────────────────────────────────────────────

  getUserQuota(userId: string): number {
    const row = this.db.prepare('SELECT quota_bytes FROM user_quotas WHERE user_id = ?').get(userId) as any
    return row ? row.quota_bytes : 0
  }

  setUserQuota(userId: string, quotaBytes: number): void {
    this.db.prepare(`
      INSERT INTO user_quotas (user_id, quota_bytes) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET quota_bytes = excluded.quota_bytes
    `).run(userId, quotaBytes)
  }

  // ─── Group Management ─────────────────────────────────────────────────────

  createGroup(name: string, description?: string): any {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    this.db.prepare('INSERT INTO groups (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(id, name, description || null, createdAt)
    return { id, name, description, createdAt }
  }

  getGroups(): any[] {
    return this.db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all()
  }

  deleteGroup(id: string): boolean {
    const res = this.db.prepare('DELETE FROM groups WHERE id = ?').run(id)
    return res.changes > 0
  }

  addUserToGroup(userId: string, groupId: string): boolean {
    try {
      this.db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, groupId)
      return true
    } catch {
      return false
    }
  }

  removeUserFromGroup(userId: string, groupId: string): boolean {
    const res = this.db.prepare('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?').run(userId, groupId)
    return res.changes > 0
  }

  getGroupMembers(groupId: string): any[] {
    return this.db.prepare(`
      SELECT u.id, u.username, u.email, u.role FROM users u
      JOIN user_groups ug ON u.id = ug.user_id WHERE ug.group_id = ?
    `).all(groupId)
  }

  // ─── ACL Management ───────────────────────────────────────────────────────

  setAccessLevel(acl: { virtualPath: string; userId?: string; groupId?: string; permissions: string[] }): any {
    const id = crypto.randomUUID()
    this.db.prepare(`
      INSERT INTO access_levels (id, virtual_path, user_id, group_id, permissions)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, acl.virtualPath, acl.userId || null, acl.groupId || null, JSON.stringify(acl.permissions))
    return { id, ...acl }
  }

  getAccessLevels(virtualPath: string): any[] {
    const rows = this.db.prepare('SELECT * FROM access_levels WHERE virtual_path = ?').all(virtualPath) as any[]
    return rows.map(r => ({
      id: r.id,
      virtualPath: r.virtual_path,
      userId: r.user_id,
      groupId: r.group_id,
      permissions: r.permissions ? JSON.parse(r.permissions) : []
    }))
  }

  deleteAccessLevel(id: string): boolean {
    const res = this.db.prepare('DELETE FROM access_levels WHERE id = ?').run(id)
    return res.changes > 0
  }

  async shutdown(): Promise<void> {
    this.db.close()
    console.log('[Core] Shutdown complete')
  }
}

export function createCore(config: CoreConfig): Core {
  return new Core(config)
}