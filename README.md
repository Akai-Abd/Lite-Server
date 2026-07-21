# Lite-Server

A modern, self-hosted, extensible file platform built with TypeScript and Node.js.

## Features

- 🚀 **Lightweight & Fast** - Built on Fastify for high performance
- 🔐 **Secure by default** - Authentication, authorization, and audit logging
- 📦 **Modular architecture** - Plugin system for extensibility
- 🌐 **Cross-platform** - Runs on Windows, Linux, and macOS
- 📱 **Modern web UI** - React-based file manager and admin dashboard
- 💾 **Multiple storage backends** - Local filesystem with support for cloud storage

## Quick Start

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Build all packages**
   ```bash
   pnpm build
   ```

3. **Start the server**
   ```bash
   cd apps/server
   pnpm start
   ```

4. **Access the applications**
   - API: http://localhost:3000
   - API Docs: http://localhost:3000/docs
   - File Manager: http://localhost:3001
   - Admin Dashboard: http://localhost:3002

## Development

Start all apps in development mode:
```bash
pnpm dev
```

This starts:
- Server on port 3000
- Web file manager on port 3001
- Admin dashboard on port 3002

## Default Credentials

- **Username:** admin
- **Password:** admin

⚠️ **Change the default password immediately in production!**

## Architecture

The project is organized as a monorepo with the following structure:

```
apps/
  server/     # Main server application
  web/        # File manager web app
  admin/      # Admin dashboard

packages/
  core/       # Database and business logic
  api/        # Fastify HTTP API
  auth/       # Authentication service
  storage/    # Storage driver abstraction
  vfs/        # Virtual file system
  plugins/    # Plugin management
  shared/     # Shared types and utilities
```

## Configuration

Create a `config.json` file in the server directory:

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "dataDir": "./data",
  "logLevel": "info",
  "corsOrigins": ["http://localhost:3001", "http://localhost:3002"],
  "uploadMaxSize": 104857600,
  "rateLimitMax": 100,
  "rateLimitWindow": 60000
}
```

## API Documentation

Once the server is running, visit http://localhost:3000/docs for interactive API documentation.

## License

MIT