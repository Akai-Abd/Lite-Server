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
    return {
      requestsTotal: 0, // Placeholder
      requestsActive: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      activeSessions: 0,
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

      const buffer = await data.toBuffer()
      const query = request.query as { path?: string }
      const customPath = query.path ? query.path.replace(/^\/+/, '') : data.filename
      const path = `/uploads/${customPath}`

      await vfs.write(path, buffer)

      return { success: true, data: { path, size: buffer.length } }
    }
  )

  server.delete<{ Body: { path: string } }>(
    '/api/files',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      if (!request.user || request.user.role !== 'admin') {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only admin users can delete files and folders' } })
      }

      const body = request.body as { path: string }
      const { path } = body
      if (!path) {
        return reply.code(400).send({ success: false, error: { code: 'MISSING_PATH', message: 'Path is required' } })
      }

      await vfs.delete(path)

      return { success: true, data: null }
    }
  )

  // Bulk delete endpoint
  server.delete<{ Body: { paths: string[] } }>(
    '/api/files/bulk',
    async (request: AuthenticatedRequest, reply) => {
      if (!request.session) {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      }

      if (!request.user || request.user.role !== 'admin') {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only admin users can delete files and folders' } })
      }

      const body = (request.body as { paths?: string[] }) || {}
      const paths = body.paths

      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST', message: 'Paths array is required' } })
      }

      const results = {
        succeeded: [] as string[],
        failed: [] as Array<{ path: string; error: string }>
      }

      // Process each file deletion
      for (const path of paths) {
        try {
          await vfs.delete(path)
          results.succeeded.push(path)
        } catch (error: any) {
          results.failed.push({
            path,
            error: error.message || 'Unknown error'
          })
        }
      }

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

  return server
}

// Re-export common types