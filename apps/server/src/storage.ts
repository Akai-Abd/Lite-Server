import { join } from 'path'


export interface FileStats {
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: Date
  modifiedAt: Date
}

export class LocalStorageDriver {
  name = 'local'
  private basePath: string = ''

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.basePath = config.basePath as string
    if (!this.basePath) {
      throw new Error('LocalStorageDriver requires basePath in config')
    }
    const fs = await import('fs/promises')
    await fs.mkdir(this.basePath, { recursive: true })
  }

  async read(path: string): Promise<Buffer> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    return fs.readFile(fullPath)
  }

  async readStream(path: string): Promise<ReadableStream> {
    const fs = await import('fs')
    const fullPath = this.resolveFullPath(path)
    const nodeStream = fs.createReadStream(fullPath)
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk))
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel() {
        nodeStream.destroy()
      },
    })
  }

  async write(path: string, data: Buffer): Promise<void> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    await fs.mkdir(fullPath.substring(0, fullPath.lastIndexOf('/')), { recursive: true })
    await fs.writeFile(fullPath, data)
  }

  async writeStream(path: string): Promise<WritableStream> {
    const fs = await import('fs')
    const fsPromises = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    await fsPromises.mkdir(fullPath.substring(0, fullPath.lastIndexOf('/')), { recursive: true })
    const nodeStream = fs.createWriteStream(fullPath)
    return new WritableStream({
      write(chunk) {
        return new Promise((resolve, reject) => {
          nodeStream.write(chunk, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      },
      close() {
        return new Promise((resolve) => {
          nodeStream.end(() => resolve())
        })
      },
      abort(err) {
        nodeStream.destroy(err as Error)
      },
    })
  }

  async delete(path: string): Promise<void> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    await fs.rm(fullPath, { recursive: true, force: true })
  }

  async exists(path: string): Promise<boolean> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    try {
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<FileStats> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    const stats = await fs.stat(fullPath)
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    }
  }

  async list(path: string): Promise<string[]> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    try {
      return await fs.readdir(fullPath)
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  async mkdir(path: string): Promise<void> {
    const fs = await import('fs/promises')
    const fullPath = this.resolveFullPath(path)
    await fs.mkdir(fullPath, { recursive: true })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fs = await import('fs/promises')
    const fullOldPath = this.resolveFullPath(oldPath)
    const fullNewPath = this.resolveFullPath(newPath)
    await fs.rename(fullOldPath, fullNewPath)
  }

  async copy(sourcePath: string, destPath: string): Promise<void> {
    const fs = await import('fs/promises')
    const fullSourcePath = this.resolveFullPath(sourcePath)
    const fullDestPath = this.resolveFullPath(destPath)
    await fs.copyFile(fullSourcePath, fullDestPath)
  }

  private resolveFullPath(path: string): string {
    const resolved = join(this.basePath, path)
    // Prevent path traversal
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Path traversal detected')
    }
    return resolved
  }
}
