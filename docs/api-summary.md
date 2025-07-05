# PHPSandbox SDK API Summary

## Overview

The PHPSandbox SDK provides programmatic access to cloud-based PHP development environments with comprehensive tooling for modern PHP development.

## Key Features

### 🏗️ **Environment Management**
- **Instant PHP Environments**: Create containerized PHP environments in seconds
- **Multiple Templates**: PHP, Laravel, Symfony, and custom templates
- **Resource Monitoring**: Real-time CPU, memory, and disk usage tracking
- **Port Management**: Automatic port detection and URL generation

### 📁 **Advanced File System**
- **Full CRUD Operations**: Create, read, update, delete files and directories
- **Intelligent Search**: File name matching and full-text search with regex support
- **Real-time Monitoring**: Watch file changes with customizable filters
- **Bulk Operations**: Download entire projects or specific directories
- **Range Reading**: Read specific line ranges from large files

### 💻 **Terminal & Process Management**
- **Interactive Terminals**: Full terminal access with resize support
- **Process Spawning**: Execute commands with stream-based I/O
- **Background Processes**: Long-running processes with proper lifecycle management
- **Environment Control**: Custom environment variables and working directories

### 📦 **Development Tools**
- **Composer Integration**: Package management with dependency resolution
- **Git Operations**: Full version control with branch, commit, and remote operations
- **Language Server Protocol**: IDE-like features (autocomplete, diagnostics, go-to-definition)
- **Interactive REPL**: Real-time PHP code execution and debugging

### 🔐 **Security & Authentication**
- **Token-based Auth**: Secure API access with JWT tokens
- **Permission Management**: Granular access control
- **Rate Limiting**: Built-in protection against abuse

## Quick Start

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

// Create client
const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);

// Create environment
const notebook = await client.notebook.create('php');
await notebook.ready();

// Work with files
await notebook.file.writeFile('hello.php', 
  new TextEncoder().encode('<?php echo "Hello World!"; ?>'), 
  { create: true, overwrite: true, unlock: false, atomic: false }
);

// Execute code
const process = await notebook.terminal.spawn('php', ['hello.php']);
const reader = process.output.getReader();
const { value } = await reader.read();
console.log(value); // "Hello World!"
```

## Core Classes

| Class | Purpose | Key Methods |
|-------|---------|-------------|
| `PHPSandbox` | Main client | `notebook.create()`, `notebook.get()`, `notebook.fork()` |
| `NotebookInstance` | Environment instance | `ready()`, `invoke()`, `listen()`, `dispose()` |
| `Filesystem` | File operations | `readFile()`, `writeFile()`, `search()`, `watch()` |
| `Terminal` | Process execution | `spawn()`, `create()`, `input()`, `resize()` |
| `Container` | Environment control | `start()`, `stop()`, `state()`, `openedPorts()` |
| `Lsp` | Language server | `connection()`, `message()`, `start()`, `close()` |
| `Composer` | PHP packages | `install()`, `update()`, `remove()`, `show()` |
| `Git` | Version control | `init()`, `add()`, `commit()`, `push()`, `pull()` |

## Event System

Real-time updates through WebSocket connections:

```typescript
// File changes
notebook.file.watch('/app', { recursive: true }, (change) => {
  console.log(`${change.path} was ${change.type}`);
});

// Terminal output
notebook.terminal.onOutput('terminal-id', (data) => {
  console.log(data.output);
});

// Container stats
notebook.container.listen('container.stats', (stats) => {
  console.log(`Memory: ${stats.memory.usage}/${stats.memory.limit}`);
});

// Connection status
notebook.onDidConnect(() => console.log('Connected'));
notebook.onDidDisconnect(() => console.log('Disconnected'));
```

## Error Handling

Structured error types with specific handling:

```typescript
import { FilesystemError, FilesystemErrorType, ErrorEvent } from '@phpsandbox/sdk';

try {
  await notebook.file.readFile('missing.php');
} catch (error) {
  if (error instanceof FilesystemError) {
    switch (error.name) {
      case FilesystemErrorType.FileNotFound:
        console.log('File not found');
        break;
      case FilesystemErrorType.NoPermissions:
        console.log('Permission denied');
        break;
    }
  }
}
```

## TypeScript Support

Full type safety with comprehensive interfaces:

```typescript
import type {
  NotebookInstance,
  FileInfo,
  Stats,
  TextSearchQuery,
  ContainerStats,
  Events
} from '@phpsandbox/sdk';

// Type-safe event handling
notebook.listen('fs.watch', (change: Events['fs.watch']) => {
  // change is properly typed as FileChange
});

// Type-safe API calls
const stats: Stats = await notebook.file.stat('/app/composer.json');
const info: FileInfo = await notebook.file.info('/app/index.php');
```

## Use Cases

### **Web Development**
- Laravel/Symfony application development
- API development and testing
- Frontend build processes
- Database migrations and seeding

### **DevOps & CI/CD**
- Automated testing environments
- Build pipelines
- Code quality analysis
- Deployment preparation

### **Education & Training**
- Interactive PHP tutorials
- Code examples and demonstrations
- Collaborative coding sessions
- Skills assessment platforms

### **Prototyping & Experimentation**
- Rapid prototyping
- Package evaluation
- Performance testing
- Algorithm development

## Performance & Limits

- **File Operations**: Optimized for files up to 10MB
- **Search**: Full-text search across thousands of files
- **Memory**: Containers with 512MB-4GB RAM options
- **Storage**: Persistent storage with automatic backups
- **Network**: High-speed connections with global CDN

## Getting Help

- 📚 **Documentation**: [Complete guides and tutorials](./getting-started.md)
- 🔧 **Examples**: [Practical code examples](../examples/)
- 💬 **Community**: GitHub Discussions and Stack Overflow
- 🐛 **Issues**: [GitHub Issues](https://github.com/phpsandbox/sdk/issues)
- 📧 **Support**: Enterprise support available

## What's Next?

1. **Follow the [Getting Started Guide](./getting-started.md)**
2. **Explore [Example Projects](../examples/)**
3. **Read the [Full API Reference](../README.md)**
4. **Join the Community**

The PHPSandbox SDK empowers you to build powerful PHP applications in the cloud with enterprise-grade reliability and performance. 
