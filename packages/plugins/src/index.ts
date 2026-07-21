import type { PluginManifest, PluginHook } from '@lite-server/shared'

export interface PluginContext {
  config: Record<string, unknown>
  log: (message: string) => void
  emit: (event: string, data: unknown) => void
}

export interface Plugin {
  manifest: PluginManifest
  context: PluginContext
  onStartup?: () => Promise<void> | void
  onShutdown?: () => Promise<void> | void
  onLogin?: (data: { userId: string; username: string }) => Promise<void> | void
  onUpload?: (data: { userId: string; filePath: string; size: number }) => Promise<void> | void
  onDownload?: (data: { userId: string; filePath: string }) => Promise<void> | void
  onDelete?: (data: { userId: string; filePath: string }) => Promise<void> | void
  onRequest?: (data: { method: string; path: string; userId?: string }) => Promise<void> | void
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private hooks: Map<PluginHook, Plugin[]> = new Map()

  async loadPlugin(path: string, config: Record<string, unknown> = {}): Promise<void> {
    try {
      const module = await import(path)
      const plugin: Plugin = module.default || module

      if (!plugin.manifest) {
        throw new Error(`Plugin at ${path} does not export a manifest`)
      }

      const context: PluginContext = {
        config,
        log: (message: string) => console.log(`[Plugin:${plugin.manifest.name}] ${message}`),
        emit: (event: string, data: unknown) => {
          console.log(`[Plugin:${plugin.manifest.name}] Event: ${event}`, data)
        },
      }

      plugin.context = context
      this.plugins.set(plugin.manifest.name, plugin)

      // Register hooks
      for (const hook of plugin.manifest.hooks) {
        if (!this.hooks.has(hook)) {
          this.hooks.set(hook, [])
        }
        this.hooks.get(hook)!.push(plugin)
      }

      // Call onStartup if defined
      if (plugin.onStartup) {
        await plugin.onStartup()
      }

      context.log('Plugin loaded successfully')
    } catch (error) {
      console.error(`Failed to load plugin from ${path}:`, error)
      throw error
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      throw new Error(`Plugin '${name}' not found`)
    }

    // Call onShutdown if defined
    if (plugin.onShutdown) {
      await plugin.onShutdown()
    }

    // Unregister hooks
    for (const hook of plugin.manifest.hooks) {
      const hookPlugins = this.hooks.get(hook)
      if (hookPlugins) {
        const index = hookPlugins.indexOf(plugin)
        if (index > -1) {
          hookPlugins.splice(index, 1)
        }
      }
    }

    this.plugins.delete(name)
    plugin.context.log('Plugin unloaded')
  }

  async triggerHook(hook: PluginHook, data: unknown): Promise<void> {
    const plugins = this.hooks.get(hook) || []

    for (const plugin of plugins) {
      try {
        const handler = plugin[hook as keyof Plugin] as ((data: unknown) => Promise<void> | void) | undefined
        if (handler) {
          await handler.call(plugin, data)
        }
      } catch (error) {
        console.error(`Error in plugin '${plugin.manifest.name}' hook '${hook}':`, error)
      }
    }
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)
  }

  listPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest)
  }

  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.plugins.keys()).map((name) =>
      this.unloadPlugin(name)
    )
    await Promise.all(shutdownPromises)
  }
}

export function createPluginManager(): PluginManager {
  return new PluginManager()
}