import crypto from 'node:crypto'
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import fastifyStatic from '@fastify/static'
import type { ServerConfig, Session, User } from './shared.js'
import * as archiverMod from 'archiver'
const archiver = (archiverMod as any).default || archiverMod
import { Readable } from 'stream'
import type { AuthService } from './auth.js'
import type { VFS } from './vfs.js'

import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface ApiServerDependencies {
  auth: AuthService
  vfs: VFS
  config: ServerConfig
  core: any // Core instance for accessing database
}

export interface AuthenticatedRequest extends FastifyRequest {
  session?: Session
  user?: User
}

export async function createApiServer(deps: ApiServerDependencies): Promise<FastifyInstance> {
  const { auth, vfs, config, core } = deps

  const server = Fastify({
    bodyLimit: config.uploadMaxSize,
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  })

  // Register plugins
  await server.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
  })

  await server.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  })

  await server.register(cookie, {
    secret: 'lite-server-secret-change-in-production',
  })

  await server.register(multipart, {
    limits: {
      fileSize: config.uploadMaxSize,
    },
  })

  await server.register(swagger, {
    swagger: {
      info: {
        title: 'Lite-Server API',
        description: 'API documentation for Lite-Server',
        version: '1.0.0'
      }
    }
  })

  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  })

  // Serve the frontend web app statically from apps/web/dist if it exists
  const webDistPath = join(__dirname, '../../../apps/web/dist')
  if (fs.existsSync(webDistPath)) {
    await server.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: false,
    })
  }

  // Authentication middleware
  server.decorateRequest('session', null)
  server.decorateRequest('user', null)

  server.addHook('onRequest', async (request: AuthenticatedRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (token) {
      const session = await auth.validateSession(token)
      if (session) {
        request.session = session
        request.user = core.getUserById(session.userId) || null
      }
    }
  })

  // ─── Health & Metrics ─────────────────────────────────────────────────────

  server.get('/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }
  })

  server.get('/metrics', async () => {
    const users = core.getAllUsers ? core.getAllUsers() : []
    const shares = core.getAllShares ? core.getAllShares() : []
    const trash = core.getTrashItems ? core.getTrashItems() : []
    const logs = core.getAuditLogs ? core.getAuditLogs(1000) : []

    return {
      usersCount: users.length,
      sharesCount: shares.length,
      trashCount: trash.length,
      auditLogsCount: logs.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })

  // ─── Auth Routes ──────────────────────────────────────────────────────────

  server.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    async (request, reply) => {
      const { username, password } = request.body

      // Fetch user from database
      const user = core.getUserByUsername(username)
      if (!user) {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } })
      }

      const isValid = await auth.verifyPassword(password, user.passwordHash)
      if (!isValid) {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } })
      }

      const session = await auth.createSession(user)

      core.logAudit({
        userId: user.id,
        action: 'login',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      }).catch(() => {})

      return { success: true, data: { token: session.token, user } }
    }
  )

  server.post('/api/auth/logout', async (request: AuthenticatedRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (token) {
      await auth.destroySession(token)
    }
    return { success: true, data: null }
  })

  // ─── Files Routes ─────────────────────────────────────────────────────────

  server.get<{ Querystring: { path: string } }>(
    '/api/files',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const query = request.query as { path?: string }
      const { path = '/' } = query
      const entries = await vfs.list(path)
      return { success: true, data: entries }
    }
  )

  server.get<{ Querystring: { path: string } }>(
    '/api/files/download',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const query = request.query as { path: string }
      const { path } = query
      if (!path) {
        return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
      }

      const stream = await vfs.readStream(path)

      reply.header('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`)
      return reply.send(stream)
    }
  )

  server.get<{ Querystring: { path: string } }>(
    '/api/files/download-zip',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const query = request.query as { path: string }
      const { path } = query
      if (!path) {
        return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
      }

      const exists = await vfs.exists(path)
      if (!exists) {
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
      }

      const archive = archiver('zip', { zlib: { level: 9 } })
      const folderName = path.split('/').pop() || 'folder'
      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${folderName}.zip"`)

      async function appendDirectory(dirPath: string, zipPath: string) {
        const items = await vfs.list(dirPath)
        for (const item of items) {
          const itemZipPath = zipPath ? `${zipPath}/${item.name}` : item.name
          if (item.type === 'directory') {
            await appendDirectory(item.virtualPath, itemZipPath)
          } else {
            const webStream = await vfs.readStream(item.virtualPath)
            const nodeStream = Readable.fromWeb(webStream as any)
            archive.append(nodeStream, { name: itemZipPath })
          }
        }
      }

      appendDirectory(path, folderName).then(() => {
        archive.finalize()
      }).catch(err => {
        request.log.error(err, 'Failed to zip directory')
        archive.abort()
      })

      return reply.send(archive)
    }
  )

  server.post<{ Querystring: { path?: string } }>(
    '/api/files/upload',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const data = await request.file()
      if (!data) {
        return reply.code(400).send({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } })
      }

      const query = request.query as { path?: string, pathBase64?: string }
      let targetPath = data.filename
      if (query.pathBase64) targetPath = decodeURIComponent(escape(atob(query.pathBase64)))
      else if (query.path) targetPath = query.path
      const customPath = targetPath.replace(/^\/+/, '')
      const path = `/uploads/${customPath}`

      const writeStream = await vfs.writeStream(path)
      await Readable.toWeb(data.file as any).pipeTo(writeStream)

      return { success: true, data: { path, size: data.file.bytesRead || 0 } }
    }
  )

  server.delete(
    '/api/files',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.user || request.user.role !== 'admin') {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only admin users can delete files and folders' } })
      }

      const body = (request.body as { path?: string }) || {}
      const { path } = body
      if (!path) {
        return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
      }

      // Soft delete: Move to .trash folder
      const trashDir = '/uploads/.trash'
      await vfs.mkdir(trashDir).catch(() => {})
      const filename = path.split('/').pop() || 'item'
      const id = crypto.randomUUID()
      const trashPath = `${trashDir}/${id}_${filename}`
      await vfs.rename(path, trashPath)

      core.addTrashItem({
        originalPath: path,
        trashPath,
        deletedBy: request.user?.username || 'user'
      })

      core.logAudit({
        userId: request.user?.id,
        action: 'delete',
        resource: path,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      }).catch(() => {})

      return { success: true, data: null }
    }
  )

  // Bulk delete endpoint
  server.delete(
    '/api/files/bulk',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.user || request.user.role !== 'admin') {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only admin users can delete files and folders' } })
      }

      const body = (request.body as { paths?: string[] }) || {}
      const paths = body.paths

      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'Paths array is required' } })
      }

      const trashDir = '/uploads/.trash'
      await vfs.mkdir(trashDir).catch(() => {})

      const results = {
        succeeded: [] as string[],
        failed: [] as Array<{ path: string; error: string }>
      }

      for (const path of paths) {
        try {
          const filename = path.split('/').pop() || 'item'
          const id = crypto.randomUUID()
          const trashPath = `${trashDir}/${id}_${filename}`
          await vfs.rename(path, trashPath)
          core.addTrashItem({ originalPath: path, trashPath, deletedBy: request.user?.username || 'user' })
          results.succeeded.push(path)
        } catch (error: any) {
          results.failed.push({ path, error: error.message || 'Unknown error' })
        }
      }

      core.logAudit({
        userId: request.user?.id,
        action: 'delete',
        resource: `bulk (${results.succeeded.length} items)`,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      }).catch(() => {})

      return { success: true, data: results }
    }
  )

  server.post(
    '/api/files/mkdir',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }
      const body = (request.body as { path?: string }) || {}
      const { path } = body
      if (!path) return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
      const targetPath = path.startsWith('/uploads') ? path : `/uploads/${path.replace(/^\/+/, '')}`
      await vfs.mkdir(targetPath)
      return { success: true, data: { path: targetPath } }
    }
  )

  server.post(
    '/api/files/rename',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }
      const body = (request.body as { oldPath?: string; newPath?: string }) || {}
      const { oldPath, newPath } = body
      if (!oldPath || !newPath) return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'oldPath and newPath are required' } })
      await vfs.rename(oldPath, newPath)
      return { success: true, data: null }
    }
  )

  server.post(
    '/api/files/move',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }
      const body = (request.body as { sources?: string[]; destination?: string }) || {}
      const { sources, destination } = body
      if (!sources?.length || !destination) return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'sources and destination required' } })
      for (const src of sources) {
        const fileName = src.split('/').pop() || ''
        const destPath = `${destination.replace(/\/+$/, '')}/${fileName}`
        await vfs.rename(src, destPath)
      }
      return { success: true, data: null }
    }
  )

  server.post(
    '/api/files/copy',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }
      const body = (request.body as { sources?: string[]; destination?: string }) || {}
      const { sources, destination } = body
      if (!sources?.length || !destination) return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'sources and destination required' } })
      for (const src of sources) {
        const fileName = src.split('/').pop() || ''
        const destPath = `${destination.replace(/\/+$/, '')}/${fileName}`
        await vfs.copy(src, destPath)
      }
      return { success: true, data: null }
    }
  )

  server.get(
    '/api/files/search',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }
      const query = (request.query as { q?: string; path?: string }) || {}
      const { q, path = '/uploads' } = query
      if (!q) return { success: true, data: [] }
      const results = await vfs.search(path, q)
      return { success: true, data: results }
    }
  )

  // ─── User Management Routes ───────────────────────────────────────────────

  server.get('/api/users', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }

    // Get all users from database
    const users = core.getAllUsers ? core.getAllUsers() : []
    return { success: true, data: { items: users, total: users.length } }
  })

  server.post<{ Body: { username: string; email: string; password: string; role: string } }>(
    '/api/users',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const body = request.body as { username: string; email: string; password: string; role: string }
      const { username, email, password, role } = body

      // Check if user already exists
      const existingUser = core.getUserByUsername(username)
      if (existingUser) {
        return reply.code(400).send({ success: false, error: { code: 'USER_EXISTS', message: 'Username already exists' } })
      }

      // Create user
      const passwordHash = await auth.hashPassword(password)
      const newUser = await core.createUser({
        username,
        email,
        role: role as any,
        passwordHash,
        mfaEnabled: false,
      })

      return { success: true, data: newUser }
    }
  )

  server.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const params = request.params as { id: string }
      const { id } = params

      // Delete user from database
      const deleted = core.deleteUser ? await core.deleteUser(id) : false
      if (!deleted) {
        return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      }

      return { success: true, data: null }
    }
  )

  server.post<{ Params: { id: string }, Body: { password: string } }>(
    '/api/users/:id/password',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      const params = request.params as { id: string }
      const { password } = request.body as { password: string }

      if (!password || password.length < 4) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Password is required' } })
      }

      const passwordHash = await auth.hashPassword(password)
      const updated = core.updateUserPassword ? await core.updateUserPassword(params.id, passwordHash) : false
      if (!updated) {
        return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      }

      return { success: true, data: null }
    }
  )

  // ─── Trash Routes ─────────────────────────────────────────────────────────

  server.get('/api/trash', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const items = core.getTrashItems()
    return { success: true, data: items }
  })

  server.post('/api/trash/restore', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const body = (request.body as { id?: string }) || {}
    if (!body.id) return reply.code(400).send({ success: false, error: { code: 'MISSING_ID', message: 'ID is required' } })

    const trashItem = core.getTrashItemById(body.id)
    if (!trashItem) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Trash item not found' } })

    await vfs.rename(trashItem.trash_path, trashItem.original_path)
    core.removeTrashItem(body.id)

    core.logAudit({
      userId: request.user?.id,
      action: 'move',
      resource: trashItem.original_path,
      metadata: { restored: true }
    }).catch(() => {})

    return { success: true, data: null }
  })

  server.delete('/api/trash/:id', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id } = (request.params as { id: string }) || {}
    const trashItem = core.getTrashItemById(id)
    if (trashItem) {
      await vfs.delete(trashItem.trash_path).catch(() => {})
      core.removeTrashItem(id)
    }
    return { success: true, data: null }
  })

  server.delete('/api/trash', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const items = core.clearTrash()
    for (const item of items) {
      await vfs.delete(item.trash_path).catch(() => {})
    }
    return { success: true, data: null }
  })

  // ─── Audit Routes ─────────────────────────────────────────────────────────

  server.get('/api/audit', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const logs = core.getAuditLogs(100)
    return { success: true, data: logs }
  })

  // ─── Share Routes ─────────────────────────────────────────────────────────

  server.post('/api/shares', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const body = (request.body as { path?: string; password?: string; expiresAt?: string; maxDownloads?: number }) || {}
    if (!body.path) return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })

    const token = crypto.randomBytes(12).toString('hex')
    const share = core.createShare({
      virtualPath: body.path,
      token,
      password: body.password || undefined,
      expiresAt: body.expiresAt || undefined,
      maxDownloads: body.maxDownloads ? Number(body.maxDownloads) : undefined,
      createdBy: request.user?.username || 'user'
    })

    core.logAudit({
      userId: request.user?.id,
      action: 'share',
      resource: body.path
    }).catch(() => {})

    return { success: true, data: share }
  })

  server.get('/api/shares', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const shares = core.getAllShares()
    return { success: true, data: shares }
  })

  server.delete('/api/shares/:id', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { id } = (request.params as { id: string }) || {}
    core.deleteShare(id)
    return { success: true, data: null }
  })

  // ─── Public Share Access (No Auth Required) ─────────────────────────────

  server.get<{ Params: { token: string } }>('/api/public/shares/:token', async (request, reply) => {
    const { token } = request.params
    const share = core.getShareByToken(token)
    if (!share) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Share link invalid or expired' } })

    const filename = share.virtual_path.split('/').pop() || 'file'
    const isExpired = share.expires_at ? new Date(share.expires_at) < new Date() : false
    const isLimitReached = share.max_downloads ? share.download_count >= share.max_downloads : false

    return {
      success: true,
      data: {
        filename,
        isProtected: !!share.password,
        isExpired,
        isLimitReached,
        downloadCount: share.download_count
      }
    }
  })

  server.get<{ Params: { token: string }; Querystring: { password?: string } }>('/api/public/shares/:token/download', async (request, reply) => {
    const { token } = request.params
    const query = (request.query as { password?: string }) || {}
    const share = core.getShareByToken(token)

    if (!share) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Share link invalid or expired' } })

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return reply.code(410).send({ success: false, error: { code: 'EXPIRED', message: 'Share link has expired' } })
    }

    if (share.max_downloads && share.download_count >= share.max_downloads) {
      return reply.code(410).send({ success: false, error: { code: 'LIMIT_REACHED', message: 'Download limit reached' } })
    }

    if (share.password && share.password !== query.password) {
      return reply.code(401).send({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Incorrect share password' } })
    }

    core.incrementShareDownload(share.id)
    const stream = await vfs.readStream(share.virtual_path)
    const filename = share.virtual_path.split('/').pop() || 'shared-file'

    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return reply.send(stream)
  })

  // ─── Quota Routes ─────────────────────────────────────────────────────────

  server.get('/api/users/:id/quota', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { id } = (request.params as { id: string }) || {}
    const quotaBytes = core.getUserQuota(id)
    return { success: true, data: { userId: id, quotaBytes } }
  })

  server.post('/api/users/:id/quota', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id } = (request.params as { id: string }) || {}
    const { quotaBytes } = (request.body as { quotaBytes: number }) || {}
    core.setUserQuota(id, Number(quotaBytes) || 0)
    return { success: true, data: { userId: id, quotaBytes } }
  })

  // ─── Group Routes ─────────────────────────────────────────────────────────

  server.get('/api/groups', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const groups = core.getGroups()
    return { success: true, data: groups }
  })

  server.post('/api/groups', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { name, description } = (request.body as { name: string; description?: string }) || {}
    if (!name) return reply.code(400).send({ success: false, error: { code: 'MISSING_NAME', message: 'Group name is required' } })
    const group = core.createGroup(name, description)
    return { success: true, data: group }
  })

  server.delete('/api/groups/:id', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id } = (request.params as { id: string }) || {}
    core.deleteGroup(id)
    return { success: true, data: null }
  })

  server.get('/api/groups/:id/members', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { id } = (request.params as { id: string }) || {}
    const members = core.getGroupMembers(id)
    return { success: true, data: members }
  })

  server.post('/api/groups/:id/members', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id } = (request.params as { id: string }) || {}
    const { userId } = (request.body as { userId: string }) || {}
    core.addUserToGroup(userId, id)
    return { success: true, data: null }
  })

  server.delete('/api/groups/:id/members/:userId', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id, userId } = (request.params as { id: string; userId: string }) || {}
    core.removeUserFromGroup(userId, id)
    return { success: true, data: null }
  })

  // ─── ACL Routes ───────────────────────────────────────────────────────────

  server.get('/api/acl', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { path } = (request.query as { path?: string }) || {}
    if (!path) return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
    const acl = core.getAccessLevels(path)
    return { success: true, data: acl }
  })

  server.post('/api/acl', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const body = (request.body as { virtualPath: string; userId?: string; groupId?: string; permissions: string[] }) || {}
    if (!body.virtualPath || !body.permissions) return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'virtualPath and permissions required' } })
    const acl = core.setAccessLevel(body)
    return { success: true, data: acl }
  })

  server.delete('/api/acl/:id', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } })
    }
    const { id } = (request.params as { id: string }) || {}
    core.deleteAccessLevel(id)
    return { success: true, data: null }
  })
  // ─── Text File Content Routes ──────────────────────────────────────────────

  server.get('/api/files/content', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { path } = (request.query as { path?: string }) || {}
    if (!path) return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
    const buf = await vfs.read(path)
    return { success: true, data: { content: buf.toString('utf-8') } }
  })

  server.put('/api/files/content', async (request: AuthenticatedRequest, reply) => {
    if (!request.session) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    }
    const { path, content } = (request.body as { path?: string; content?: string }) || {}
    if (!path || content === undefined) return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'path and content required' } })
    await vfs.write(path, Buffer.from(content, 'utf-8'))
    return { success: true, data: null }
  })

  return server
}

// Re-export common types