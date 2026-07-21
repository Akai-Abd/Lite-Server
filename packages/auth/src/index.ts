import { hash, verify } from 'argon2'
import type { User, Session } from '@lite-server/shared'

export interface AuthService {
  hashPassword(password: string): Promise<string>
  verifyPassword(password: string, hash: string): Promise<boolean>
  createSession(user: User): Promise<Session>
  validateSession(token: string): Promise<Session | null>
  destroySession(token: string): Promise<void>
}

export class AuthManager implements AuthService {
  private sessions: Map<string, Session> = new Map()

  async hashPassword(password: string): Promise<string> {
    return hash(password, {
      type: 2, // Argon2id
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await verify(hash, password)
    } catch {
      return false
    }
  }

  async createSession(user: User): Promise<Session> {
    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24) // 24 hour expiry

    const session: Session = {
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    }

    this.sessions.set(token, session)
    return session
  }

  async validateSession(token: string): Promise<Session | null> {
    const session = this.sessions.get(token)
    if (!session) return null

    const expiresAt = new Date(session.expiresAt)
    if (expiresAt < new Date()) {
      this.sessions.delete(token)
      return null
    }

    return session
  }

  async destroySession(token: string): Promise<void> {
    this.sessions.delete(token)
  }

  async cleanExpiredSessions(): Promise<void> {
    const now = new Date()
    for (const [token, session] of this.sessions) {
      const expiresAt = new Date(session.expiresAt)
      if (expiresAt < now) {
        this.sessions.delete(token)
      }
    }
  }
}

export function createAuthService(): AuthService {
  return new AuthManager()
}