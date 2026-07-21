import { z } from 'zod'

// ─── Plugin Types (Export First) ──────────────────────────────────────────────

export const PluginHookSchema = z.enum([
  'onStartup',
  'onLogin',
  'onUpload',
  'onDownload',
  'onDelete',
  'onRequest',
  'onShutdown',
  'onFileCreated',
  'onFileMoved',
  'onFileRenamed',
  'onShareCreated',
  'onShareDeleted',
])
export type PluginHook = z.infer<typeof PluginHookSchema>

export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  hooks: z.array(PluginHookSchema),
  dependencies: z.record(z.string()).optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

// ─── Base Entities ────────────────────────────────────────────────────────────

export const UserRole = z.enum(['admin', 'user', 'guest'])
export type UserRole = z.infer<typeof UserRole>

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(2).max(64),
  email: z.string().email(),
  role: UserRole,
  passwordHash: z.string(),
  mfaEnabled: z.boolean().default(false),
  mfaSecret: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

export const GroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(128),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type Group = z.infer<typeof GroupSchema>

export const FileType = z.enum(['file', 'directory', 'symlink'])
export type FileType = z.infer<typeof FileType>

export const FileEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: FileType,
  size: z.number().int().nonnegative(),
  parentId: z.string().uuid().nullable(),
  mountId: z.string().uuid(),
  virtualPath: z.string(),
  storagePath: z.string(),
  mimeType: z.string().optional(),
  checksum: z.string().optional(),
  hidden: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type FileEntry = z.infer<typeof FileEntrySchema>

export const MountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  driver: z.string(),
  config: z.record(z.unknown()),
  basePath: z.string(),
  readOnly: z.boolean().default(false),
  enabled: z.boolean().default(true),
})
export type Mount = z.infer<typeof MountSchema>

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string(),
  userId: z.string().uuid(),
  token: z.string(),
  expiresAt: z.string().datetime(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type Session = z.infer<typeof SessionSchema>

// ─── Permissions ─────────────────────────────────────────────────────────────

export const Permission = z.enum([
  'read', 'write', 'delete', 'share', 'admin',
])
export type Permission = z.infer<typeof Permission>

export const AccessLevelSchema = z.object({
  fileEntryId: z.string().uuid().optional(),
  virtualPath: z.string().optional(),
  userId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  permissions: z.array(Permission),
})
export type AccessLevel = z.infer<typeof AccessLevelSchema>

// ─── Sharing ──────────────────────────────────────────────────────────────────

export const ShareSchema = z.object({
  id: z.string().uuid(),
  fileEntryId: z.string().uuid(),
  token: z.string(),
  password: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  maxDownloads: z.number().int().nonnegative().optional(),
  downloadCount: z.number().int().nonnegative().default(0),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
})
export type Share = z.infer<typeof ShareSchema>

// ─── Plugins ─────────────────────────────────────────────────────────────────

export const PluginLifecycle = z.enum(['loaded', 'enabled', 'disabled'])
export type PluginLifecycle = z.infer<typeof PluginLifecycle>

export const PluginSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  path: z.string(),
  config: z.record(z.unknown()),
  lifecycle: PluginLifecycle,
  hooks: z.array(z.string()),
  loadedAt: z.string().datetime().optional(),
  enabledAt: z.string().datetime().optional(),
})
export type Plugin = z.infer<typeof PluginSchema>

// ─── Audit ────────────────────────────────────────────────────────────────────

export const AuditAction = z.enum([
  'login', 'logout', 'upload', 'download', 'delete', 'rename',
  'move', 'copy', 'share', 'unshare', 'admin_action',
])
export type AuditAction = z.infer<typeof AuditAction>

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  action: AuditAction,
  resource: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type AuditLog = z.infer<typeof AuditLogSchema>

// ─── API Response Wrappers ────────────────────────────────────────────────────

export const ApiSuccessSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
})
export type ApiSuccess = z.infer<typeof ApiSuccessSchema>

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

export const ApiResponseSchema = z.union([ApiSuccessSchema, ApiErrorSchema])

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(50),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
})
export type Pagination = z.infer<typeof PaginationSchema>

export const PaginatedResultSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  pages: z.number().int().positive(),
})
export type PaginatedResult<T = unknown> = z.infer<typeof PaginatedResultSchema> & {
  items: T[]
}

// ─── Health / Metrics ─────────────────────────────────────────────────────────

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  uptime: z.number(),
  version: z.string(),
  timestamp: z.string().datetime(),
})
export type HealthStatus = z.infer<typeof HealthStatusSchema>

export const MetricsSchema = z.object({
  requestsTotal: z.number(),
  requestsActive: z.number(),
  bytesUploaded: z.number(),
  bytesDownloaded: z.number(),
  activeSessions: z.number(),
  timestamp: z.string().datetime(),
})
export type Metrics = z.infer<typeof MetricsSchema>

// ─── Upload ───────────────────────────────────────────────────────────────────

export const ChunkStatus = z.enum(['pending', 'uploaded', 'failed'])
export type ChunkStatus = z.infer<typeof ChunkStatus>

export const UploadChunkSchema = z.object({
  uploadId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  status: ChunkStatus,
  size: z.number().int().nonnegative(),
  checksum: z.string().optional(),
})
export type UploadChunk = z.infer<typeof UploadChunkSchema>

export const UploadSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  filename: z.string(),
  totalSize: z.number().int().nonnegative(),
  chunkSize: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  chunksUploaded: z.number().int().nonnegative().default(0),
  parentId: z.string().uuid().nullable(),
  virtualPath: z.string(),
  storagePath: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})
export type UploadSession = z.infer<typeof UploadSessionSchema>

// ─── Config ───────────────────────────────────────────────────────────────────

export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(3000),
  dataDir: z.string().default('./data'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  corsOrigins: z.array(z.string()).default([]),
  sessionMaxAge: z.number().int().nonnegative().default(86400),
  uploadChunkSize: z.number().int().nonnegative().default(5 * 1024 * 1024),
  uploadMaxSize: z.number().int().nonnegative().default(100 * 1024 * 1024 * 1024),
  maxConcurrentUploads: z.number().int().nonnegative().default(10),
  rateLimitMax: z.number().int().nonnegative().default(1000),
  rateLimitWindow: z.number().int().nonnegative().default(60000),
  tlsEnabled: z.boolean().default(false),
  tlsCert: z.string().optional(),
  tlsKey: z.string().optional(),
})
export type ServerConfig = z.infer<typeof ServerConfigSchema>