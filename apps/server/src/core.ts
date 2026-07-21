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
        file_entry_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        password TEXT,
        expires_at TEXT,
        max_downloads INTEGER,
        download_count INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (file_entry_id) REFERENCES file_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
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

      CREATE TABLE IF NOT EXISTS access_levels (
        id TEXT PRIMARY KEY,
        file_entry_id TEXT,
        virtual_path TEXT,
        user_id TEXT,
        group_id TEXT,
        permissions TEXT NOT NULL,
        FOREIGN KEY (file_entry_id) REFERENCES file_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_file_entries_virtual_path ON file_entries(virtual_path);
      CREATE INDEX IF NOT EXISTS idx_file_entries_parent_id ON file_entries(parent_id);
      CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `)
  }

  // ─── User Management ──────────────────────────────────────────────────────

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const newUser: User = {
      id,
      ...user,
      createdAt: now,
      updatedAt: now,
    }

    this.db.prepare(`
      INSERT INTO users (id, username, email, role, password_hash, mfa_enabled, mfa_secret, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newUser.id,
      newUser.username,
      newUser.email,
      newUser.role,
      newUser.passwordHash,
      newUser.mfaEnabled ? 1 : 0,
      newUser.mfaSecret || null,
      newUser.createdAt,
      newUser.updatedAt
    )

    return newUser
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
      JSON.stringify(log.metadata),
      log.ipAddress || null,
      log.userAgent || null,
      createdAt
    )
  }

  async shutdown(): Promise<void> {
    this.db.close()
    console.log('[Core] Shutdown complete')
  }
}

export function createCore(config: CoreConfig): Core {
  return new Core(config)
}