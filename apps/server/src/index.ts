import { createCore } from '@lite-server/core'
import { createApiServer } from '@lite-server/api'
import { ServerConfigSchema, type ServerConfig } from '@lite-server/shared'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  const configPath = process.env.CONFIG_PATH || join(__dirname, '../config.json')
  const projectRoot = join(dirname(configPath), '../..')
  let config: ServerConfig

  if (existsSync(configPath)) {
    const configFile = JSON.parse(readFileSync(configPath, 'utf-8'))
    config = ServerConfigSchema.parse(configFile)
    console.log(`[Server] Loaded config from ${configPath}`)
  } else {
    config = ServerConfigSchema.parse({})
    console.log('[Server] No config file found, using defaults')
  }

  const core = createCore({
    dataDir: config.dataDir,
    logLevel: config.logLevel,
  })

  await core.initialize()

  // Create default admin user
  const existingAdmin = core.getUserByUsername('admin')
  if (!existingAdmin) {
    const passwordHash = await core.auth.hashPassword('admin')
    await core.createUser({
      username: 'admin',
      email: 'admin@lite-server.local',
      role: 'admin',
      passwordHash,
      mfaEnabled: false,
    })
    console.log('[Server] Created default admin user (admin/admin)')
  }

  // Create default mount
  const defaultMount = {
    id: crypto.randomUUID(),
    name: 'local',
    driver: 'local',
    config: { basePath: join(projectRoot, config.dataDir, 'storage') },
    basePath: '/',
    readOnly: false,
    enabled: true,
  }
  await core.vfs.mount(defaultMount)

  const server = await createApiServer({
    auth: core.auth,
    vfs: core.vfs,
    pluginManager: core.pluginManager,
    config,
    core,
  })

  try {
    const address = await server.listen({
      host: config.host,
      port: config.port,
    })
    console.log(`[Server] Lite-Server started on ${address}`)
  } catch (err) {
    console.error('[Server] Failed to start:', err)
    process.exit(1)
  }

  const shutdown = async () => {
    console.log('[Server] Shutting down...')
    await server.close()
    await core.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})
