<div align="center">
  <img src="assets/banner.png" alt="Lite-Server Banner" width="100%" />
  
  # Lite-Server 🚀
  
  **A modern, lightweight, and extensible file platform built with TypeScript & Node.js.**
  
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
  [![pnpm](https://img.shields.io/badge/pnpm-9.0-orange.svg)](https://pnpm.io/)
  
</div>

---

## ✨ Features

- 🚀 **High Performance:** Built on [Fastify](https://www.fastify.io/) for lightning-fast API responses.
- 🔐 **Secure by Design:** Built-in authentication, robust authorization, and comprehensive audit logging.
- 🌐 **Cross-Platform:** Runs seamlessly on Windows, Linux, and macOS.
- 📱 **Modern Interface:** Beautiful, responsive React-based file manager.
- 💾 **Local Storage:** Direct local filesystem operations for maximum speed.

---

## ⚡ Quick Start

Get your environment up and running in seconds.

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Build the Workspace
```bash
pnpm build
```

### 3. Start Development
Run the complete ecosystem (API, File Manager) concurrently:
```bash
pnpm dev
```

### 4. Access the Applications
The backend server statically serves the frontend directly, meaning you can access everything from a single port:

| Application | URL |
| ----------- | --- |
| **API & UI Server** | [http://localhost:3000](http://localhost:3000) |
| **API Documentation** | [http://localhost:3000/docs](http://localhost:3000/docs) |
| **File Manager UI** | [http://localhost:3000](http://localhost:3000) |
| **Admin Console** | [http://localhost:3000](http://localhost:3000) |

*(Note: During active development with `pnpm dev`, you can also use Vite's dev server on `http://localhost:3001` for Hot Module Replacement).*

---

## 🔑 Default Credentials

- **Username:** `admin`
- **Password:** `admin`

> [!WARNING]
> Ensure you change the default password immediately when deploying to a production environment!

---

## 🏗️ Architecture

Organized into a simple two-app workspace for maximum maintainability:

```text
📦 lite-server
 ┗ 📂 apps
   ┣ 📂 server     # Main Fastify backend (API, Auth, Storage, VFS)
   ┗ 📂 web        # React-based file manager UI
```

---

## ⚙️ Configuration

Create a `config.json` inside the `apps/server` directory to customize your deployment:

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "dataDir": "./data",
  "logLevel": "info",
  "corsOrigins": ["http://localhost:3001"],

  "rateLimitMax": 100,
  "rateLimitWindow": 60000
}
```

---

## 📚 API Documentation

Once the server is running, navigate to [http://localhost:3000/docs](http://localhost:3000/docs) to access the interactive Swagger OpenAPI documentation.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
            Build by ❤️ ABDURRAHMAN
