import type { FileEntry, Mount } from './shared.js'
import { LocalStorageDriver } from './storage.js'


export class VFS {
  private mounts: Map<string, Mount> = new Map()
  private drivers: Map<string, LocalStorageDriver> = new Map()

  async initialize(): Promise<void> {
    // Load mounts from database (placeholder)
  }

  async mount(mount: Mount): Promise<void> {
    const driver = new LocalStorageDriver()
    await driver.initialize(mount.config)
    this.mounts.set(mount.id, mount)
    this.drivers.set(mount.id, driver)
  }

  async unmount(mountId: string): Promise<void> {
    this.mounts.delete(mountId)
    this.drivers.delete(mountId)
  }

  async resolvePath(virtualPath: string): Promise<{ mount: Mount; storagePath: string }> {
    // Find the mount that matches the virtualPath prefix
    for (const [, mount] of this.mounts) {
      if (virtualPath.startsWith(mount.basePath)) {
        const storagePath = virtualPath.slice(mount.basePath.length)
        return { mount, storagePath }
      }
    }
    throw new Error(`No mount found for virtual path: ${virtualPath}`)
  }

  async list(virtualPath: string): Promise<FileEntry[]> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)

    const entries = await driver.list(storagePath)
    return Promise.all(
      entries.map(async (name) => {
        const itemStoragePath = storagePath ? `${storagePath}/${name}` : name
        const stats = await driver.stat(itemStoragePath).catch(() => null)
        const isDir = stats?.isDirectory ?? false
        return {
          id: crypto.randomUUID(),
          name,
          type: isDir ? ('directory' as const) : ('file' as const),
          size: stats?.size || 0,
          parentId: null,
          mountId: mount.id,
          virtualPath: virtualPath === '/' ? `/${name}` : `${virtualPath}/${name}`,
          storagePath: itemStoragePath,
          hidden: false,
          readOnly: mount.readOnly,
          createdAt: stats?.createdAt ? stats.createdAt.toISOString() : new Date().toISOString(),
          updatedAt: stats?.modifiedAt ? stats.modifiedAt.toISOString() : new Date().toISOString(),
        }
      })
    )
  }

  async read(virtualPath: string): Promise<Buffer> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    return driver.read(storagePath)
  }

  async readStream(virtualPath: string): Promise<ReadableStream> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    return driver.readStream(storagePath)
  }

  async write(virtualPath: string, data: Buffer): Promise<void> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    if (mount.readOnly) throw new Error('Mount is read-only')
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    await driver.write(storagePath, data)
  }

  async writeStream(virtualPath: string): Promise<WritableStream> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    if (mount.readOnly) throw new Error('Mount is read-only')
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    return driver.writeStream(storagePath)
  }

  async delete(virtualPath: string): Promise<void> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    if (mount.readOnly) throw new Error('Mount is read-only')
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    await driver.delete(storagePath)
  }

  async exists(virtualPath: string): Promise<boolean> {
    try {
      const { mount, storagePath } = await this.resolvePath(virtualPath)
      const driver = this.drivers.get(mount.id)
      if (!driver) return false
      return driver.exists(storagePath)
    } catch {
      return false
    }
  }

  async mkdir(virtualPath: string): Promise<void> {
    const { mount, storagePath } = await this.resolvePath(virtualPath)
    if (mount.readOnly) throw new Error('Mount is read-only')
    const driver = this.drivers.get(mount.id)
    if (!driver) throw new Error(`Driver not found for mount ${mount.id}`)
    await driver.mkdir(storagePath)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const { mount: oldMount, storagePath: oldStoragePath } = await this.resolvePath(oldPath)
    const { mount: newMount, storagePath: newStoragePath } = await this.resolvePath(newPath)

    if (oldMount.id !== newMount.id) {
      throw new Error('Cannot rename across mounts')
    }
    if (oldMount.readOnly) throw new Error('Mount is read-only')

    const driver = this.drivers.get(oldMount.id)
    if (!driver) throw new Error(`Driver not found for mount ${oldMount.id}`)
    await driver.rename(oldStoragePath, newStoragePath)
  }

  async copy(sourcePath: string, destPath: string): Promise<void> {
    const { mount: sourceMount, storagePath: sourceStoragePath } = await this.resolvePath(sourcePath)
    const { mount: destMount, storagePath: destStoragePath } = await this.resolvePath(destPath)

    if (destMount.readOnly) throw new Error('Destination mount is read-only')

    if (sourceMount.id === destMount.id) {
      const driver = this.drivers.get(sourceMount.id)
      if (!driver) throw new Error(`Driver not found for mount ${sourceMount.id}`)
      await driver.copy(sourceStoragePath, destStoragePath)
    } else {
      // Cross-mount copy: read from source and write to dest
      const data = await this.read(sourcePath)
      await this.write(destPath, data)
    }
  }
}

export function createVFS(): VFS {
  return new VFS()
}