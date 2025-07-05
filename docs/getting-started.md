# Getting Started with PHPSandbox SDK

This guide will help you get up and running with the PHPSandbox SDK in just a few minutes.

## Prerequisites

- Node.js 18+ or compatible JavaScript runtime
- PHPSandbox API token (get one at [phpsandbox.io](https://phpsandbox.io))
- TypeScript knowledge (recommended but not required)

## Installation

Install the SDK using your preferred package manager:

```bash
# Using npm
npm install @phpsandbox/sdk

# Using yarn
yarn add @phpsandbox/sdk

# Using pnpm
pnpm add @phpsandbox/sdk
```

## Setting Up Authentication

### Option 1: Environment Variables (Recommended)

Create a `.env` file in your project root:

```env
PHPSANDBOX_TOKEN=your_api_token_here
```

Then use it in your code:

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);
```

### Option 2: Direct Token

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

const client = new PHPSandbox('your-api-token-here');
```

## Your First Notebook

Let's create your first PHP development environment:

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

async function createFirstNotebook() {
  // Initialize the SDK
  const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);

  // Create a new PHP notebook
  const notebook = await client.notebook.create('php');

  // Wait for the environment to be ready
  await notebook.ready();

  console.log('✅ Notebook is ready!');

  return notebook;
}

// Run it
createFirstNotebook().catch(console.error);
```

## Basic File Operations

Once you have a notebook, you can work with files:

```typescript
async function workWithFiles(notebook) {
  // Create a simple PHP file
  await notebook.file.writeFile('hello.php', new TextEncoder().encode('<?php echo "Hello, PHPSandbox!"; ?>'), {
    create: true,
    overwrite: true,
    unlock: false,
    atomic: false,
  });

  // Read the file back
  const content = await notebook.file.readFile('hello.php');
  const text = new TextDecoder().decode(content as Uint8Array);
  console.log('File content:', text);

  // Check if file exists
  const exists = await notebook.file.exists('hello.php');
  console.log('File exists:', exists);

  // Get file information
  const info = await notebook.file.info('hello.php');
  console.log('File info:', info);
}
```

## Running PHP Code

Execute your PHP files using the terminal:

```typescript
async function runPhpCode(notebook) {
  // Execute PHP file
  const process = await notebook.terminal.spawn('php', ['hello.php']);

  // Listen to output
  const reader = process.output.getReader();
  let output = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += value;
      console.log('Output:', value);
    }
  } finally {
    reader.releaseLock();
  }

  // Wait for process to complete
  const exitCode = await process.exit;
  console.log('Process finished with exit code:', exitCode);

  return output;
}
```

## Working with Composer

For PHP projects with dependencies:

```typescript
async function setupComposerProject(notebook) {
  // Initialize a new Composer project
  await notebook.composer.init({
    name: 'my-project/hello-world',
    description: 'My first PHPSandbox project',
    type: 'project',
  });

  // Install a package
  await notebook.composer.install(['monolog/monolog']);

  // Create a PHP file that uses the dependency
  const phpCode = `<?php
require_once 'vendor/autoload.php';

use Monolog\\Logger;
use Monolog\\Handler\\StreamHandler;

$log = new Logger('my-app');
$log->pushHandler(new StreamHandler('php://stdout', Logger::INFO));

$log->info('Hello from Monolog!');
?>`;

  await notebook.file.writeFile('index.php', new TextEncoder().encode(phpCode), {
    create: true,
    overwrite: true,
    unlock: false,
    atomic: false,
  });

  // Run the script
  const process = await notebook.terminal.spawn('php', ['index.php']);

  // Handle output
  process.output
    .getReader()
    .read()
    .then(({ value }) => {
      console.log('Composer project output:', value);
    });

  await process.exit;
}
```

## Real-time File Monitoring

Monitor file changes in real-time:

```typescript
async function monitorFiles(notebook) {
  // Watch for file changes
  const watcher = notebook.file.watch(
    '/app', // Watch the app directory
    {
      recursive: true,
      excludes: ['node_modules/**', 'vendor/**'],
      correlationId: 1,
    },
    (change) => {
      console.log(`File ${change.path} was ${change.type}`);

      // React to PHP file changes
      if (change.path.endsWith('.php') && change.type === 'UPDATED') {
        console.log('PHP file updated, consider running tests');
      }
    }
  );

  // Clean up when done
  // watcher.dispose();
}
```

## Error Handling

Always handle errors gracefully:

```typescript
import { FilesystemError, FilesystemErrorType, ErrorEvent } from '@phpsandbox/sdk';

async function safeFileOperation(notebook) {
  try {
    const content = await notebook.file.readFile('nonexistent.php');
  } catch (error) {
    if (error instanceof FilesystemError) {
      switch (error.name) {
        case FilesystemErrorType.FileNotFound:
          console.log('File not found, creating it...');
          await notebook.file.writeFile('nonexistent.php', new TextEncoder().encode('<?php echo "Created!"; ?>'), {
            create: true,
            overwrite: false,
            unlock: false,
            atomic: false,
          });
          break;
        case FilesystemErrorType.NoPermissions:
          console.error('Permission denied');
          break;
        default:
          console.error('Filesystem error:', error.message);
      }
    } else if (error instanceof ErrorEvent) {
      console.error(`API Error ${error.code}: ${error.message}`);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}
```

## Complete Example

Here's a complete example that puts it all together:

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

async function completeExample() {
  try {
    // 1. Create client and notebook
    const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);
    const notebook = await client.notebook.create('php');
    await notebook.ready();

    console.log('✅ Notebook ready');

    // 2. Create a PHP project structure
    await notebook.file.createDirectory('src');
    await notebook.file.createDirectory('tests');

    // 3. Create a simple class
    const classCode = `<?php
class Calculator {
    public function add($a, $b) {
        return $a + $b;
    }
    
    public function multiply($a, $b) {
        return $a * $b;
    }
}
?>`;

    await notebook.file.writeFile('src/Calculator.php', new TextEncoder().encode(classCode), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // 4. Create a test file
    const testCode = `<?php
require_once 'src/Calculator.php';

$calc = new Calculator();

// Test addition
$result = $calc->add(2, 3);
echo "2 + 3 = " . $result . "\\n";

// Test multiplication
$result = $calc->multiply(4, 5);
echo "4 * 5 = " . $result . "\\n";

echo "All tests passed!\\n";
?>`;

    await notebook.file.writeFile('test.php', new TextEncoder().encode(testCode), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // 5. Run the tests
    console.log('🧪 Running tests...');
    const process = await notebook.terminal.spawn('php', ['test.php']);

    const reader = process.output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        console.log('Test output:', value.trim());
      }
    } finally {
      reader.releaseLock();
    }

    const exitCode = await process.exit;
    console.log(`✅ Tests completed with exit code: ${exitCode}`);

    // 6. Clean up
    notebook.dispose();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the example
completeExample();
```

## Next Steps

Now that you understand the basics, you can:

1. **Explore Advanced Features**: Check out the [API Reference](../README.md#api-reference) for all available methods
2. **Try Laravel**: Use the `laravel` template for Laravel-specific features
3. **Set up Git**: Use the Git integration for version control
4. **Use LSP**: Set up Language Server Protocol for IDE features
5. **Monitor Resources**: Use container stats to monitor your environment

## Best Practices

1. **Always handle errors** - Use try-catch blocks and check for specific error types
2. **Clean up resources** - Call `dispose()` on notebooks and watchers when done
3. **Use environment variables** - Keep your API tokens secure
4. **Monitor resource usage** - Check container stats to avoid hitting limits
5. **Use TypeScript** - Take advantage of the full type safety provided by the SDK

## Getting Help

If you run into issues:

- Check the [examples](./examples/) directory for more code samples
- Review the [API Reference](../README.md#api-reference) for detailed method documentation
- Visit [docs.phpsandbox.io](https://docs.phpsandbox.io) for additional guides
- Open an issue on [GitHub](https://github.com/phpsandbox/sdk/issues)

Happy coding! 🚀
