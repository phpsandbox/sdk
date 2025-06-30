/**
 * Basic PHP Project Setup Example
 *
 * This example demonstrates how to create a PHP project with Composer dependencies,
 * file management, and process execution using the PHPSandbox SDK.
 */

import { PHPSandbox, NotebookInstance, FileChangeType } from '@phpsandbox/sdk';

export class BasicPhpProject {
  private client: PHPSandbox;
  private notebook: NotebookInstance | null = null;

  constructor(token: string) {
    this.client = new PHPSandbox(token);
  }

  async createProject(projectName: string): Promise<NotebookInstance> {
    console.log('🚀 Creating PHP project...');

    // Create notebook from PHP template
    this.notebook = await this.client.notebook.create('php');
    await this.notebook.ready();

    console.log('✅ PHP notebook ready');

    // Set up project structure
    await this.setupProjectStructure(projectName);

    // Set up Composer
    await this.setupComposer(projectName);

    // Create sample PHP files
    await this.createSampleFiles();

    // Set up file watching
    await this.setupFileWatching();

    // Run the project
    await this.runProject();

    console.log('🎉 PHP project setup complete!');
    return this.notebook;
  }

  private async setupProjectStructure(projectName: string): Promise<void> {
    console.log('📁 Setting up project structure...');

    // Create directories
    await this.notebook!.file.createDirectory('src');
    await this.notebook!.file.createDirectory('tests');
    await this.notebook!.file.createDirectory('docs');

    // Create README
    const readmeContent = `# ${projectName}

A PHP project created with PHPSandbox SDK.

## Installation

\`\`\`bash
composer install
\`\`\`

## Usage

\`\`\`bash
php src/app.php
\`\`\`

## Testing

\`\`\`bash
php tests/run-tests.php
\`\`\`
`;

    await this.notebook!.file.writeFile('README.md', new TextEncoder().encode(readmeContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    console.log('✅ Project structure created');
  }

  private async setupComposer(projectName: string): Promise<void> {
    console.log('📦 Setting up Composer...');

    // Create composer.json
    const composerConfig = {
      'name': `phpsandbox/${projectName.toLowerCase().replace(/\s+/g, '-')}`,
      'description': `A PHP project: ${projectName}`,
      'type': 'project',
      'require': {
        php: '^8.0',
        monolog: '^3.0',
      },
      'require-dev': {
        phpunit: '^10.0',
      },
      'autoload': {
        'psr-4': {
          'App\\': 'src/',
        },
      },
      'autoload-dev': {
        'psr-4': {
          'Tests\\': 'tests/',
        },
      },
    };

    await this.notebook!.file.writeFile('composer.json', new TextEncoder().encode(JSON.stringify(composerConfig, null, 2)), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Install dependencies
    const installProcess = await this.notebook!.terminal.spawn('composer', ['install']);

    // Monitor install progress
    const reader = installProcess.output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        console.log('Composer:', value.trim());
      }
    } finally {
      reader.releaseLock();
    }

    await installProcess.exit;
    console.log('✅ Composer dependencies installed');
  }

  private async createSampleFiles(): Promise<void> {
    console.log('📝 Creating sample PHP files...');

    // Create main application class
    const appClassContent = `<?php

namespace App;

use Monolog\\Logger;
use Monolog\\Handler\\StreamHandler;

class Application
{
    private Logger $logger;

    public function __construct()
    {
        $this->logger = new Logger('app');
        $this->logger->pushHandler(new StreamHandler('php://stdout', Logger::INFO));
    }

    public function run(): void
    {
        $this->logger->info('Application started');

        $calculator = new Calculator();
        $result = $calculator->add(10, 5);

        $this->logger->info("Calculation result: 10 + 5 = {$result}");

        $this->processData(['apple', 'banana', 'cherry']);

        $this->logger->info('Application finished');
    }

    private function processData(array $items): void
    {
        $this->logger->info('Processing items: ' . implode(', ', $items));

        foreach ($items as $index => $item) {
            $this->logger->info("Item {$index}: {$item}");
        }
    }
}
`;

    await this.notebook!.file.writeFile('src/Application.php', new TextEncoder().encode(appClassContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Create calculator class
    const calculatorContent = `<?php

namespace App;

class Calculator
{
    public function add(int $a, int $b): int
    {
        return $a + $b;
    }

    public function subtract(int $a, int $b): int
    {
        return $a - $b;
    }

    public function multiply(int $a, int $b): int
    {
        return $a * $b;
    }

    public function divide(int $a, int $b): float
    {
        if ($b === 0) {
            throw new \\InvalidArgumentException('Division by zero');
        }

        return $a / $b;
    }
}
`;

    await this.notebook!.file.writeFile('src/Calculator.php', new TextEncoder().encode(calculatorContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Create main entry point
    const appContent = `<?php

require_once __DIR__ . '/vendor/autoload.php';

use App\\Application;

try {
    $app = new Application();
    $app->run();
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\\n";
    exit(1);
}
`;

    await this.notebook!.file.writeFile('src/app.php', new TextEncoder().encode(appContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Create test file
    const testContent = `<?php

require_once __DIR__ . '/../vendor/autoload.php';

use App\\Calculator;

class CalculatorTest
{
    private Calculator $calculator;
    private int $passed = 0;
    private int $failed = 0;

    public function __construct()
    {
        $this->calculator = new Calculator();
    }

    public function runTests(): void
    {
        echo "Running Calculator tests...\\n";

        $this->testAddition();
        $this->testSubtraction();
        $this->testMultiplication();
        $this->testDivision();
        $this->testDivisionByZero();

        echo "\\nTest Results: {$this->passed} passed, {$this->failed} failed\\n";

        if ($this->failed > 0) {
            exit(1);
        }
    }

    private function testAddition(): void
    {
        $result = $this->calculator->add(2, 3);
        $this->assertEquals(5, $result, 'Addition test');
    }

    private function testSubtraction(): void
    {
        $result = $this->calculator->subtract(5, 3);
        $this->assertEquals(2, $result, 'Subtraction test');
    }

    private function testMultiplication(): void
    {
        $result = $this->calculator->multiply(4, 3);
        $this->assertEquals(12, $result, 'Multiplication test');
    }

    private function testDivision(): void
    {
        $result = $this->calculator->divide(10, 2);
        $this->assertEquals(5.0, $result, 'Division test');
    }

    private function testDivisionByZero(): void
    {
        try {
            $this->calculator->divide(10, 0);
            $this->fail('Division by zero test - should have thrown exception');
        } catch (InvalidArgumentException $e) {
            $this->pass('Division by zero test');
        }
    }

    private function assertEquals($expected, $actual, string $testName): void
    {
        if ($expected === $actual) {
            $this->pass($testName);
        } else {
            $this->fail("$testName - Expected: $expected, Got: $actual");
        }
    }

    private function pass(string $message): void
    {
        echo "✅ $message\\n";
        $this->passed++;
    }

    private function fail(string $message): void
    {
        echo "❌ $message\\n";
        $this->failed++;
    }
}

$test = new CalculatorTest();
$test->runTests();
`;

    await this.notebook!.file.writeFile('tests/run-tests.php', new TextEncoder().encode(testContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    console.log('✅ Sample files created');
  }

  private async setupFileWatching(): Promise<void> {
    console.log('👀 Setting up file watching...');

    this.notebook!.file.watch(
      '/app',
      {
        recursive: true,
        excludes: ['vendor/**', 'node_modules/**', '.git/**'],
        correlationId: 1,
      },
      (change) => {
        const action =
          change.type === FileChangeType.ADDED
            ? 'added'
            : change.type === FileChangeType.UPDATED
              ? 'updated'
              : change.type === FileChangeType.DELETED
                ? 'deleted'
                : 'modified';

        console.log(`📄 File ${change.path} ${action}`);

        // Auto-run tests on PHP file changes
        if (change.path.endsWith('.php') && change.type === FileChangeType.UPDATED) {
          console.log('🧪 PHP file changed, consider running tests');
        }
      }
    );

    console.log('✅ File watching enabled');
  }

  private async runProject(): Promise<void> {
    console.log('🚀 Running project...');

    // Run tests first
    console.log('🧪 Running tests...');
    const testProcess = await this.notebook!.terminal.spawn('php', ['tests/run-tests.php']);

    const testReader = testProcess.output.getReader();
    try {
      while (true) {
        const { done, value } = await testReader.read();
        if (done) break;
        console.log('Test:', value.trim());
      }
    } finally {
      testReader.releaseLock();
    }

    const testExitCode = await testProcess.exit;
    console.log(`✅ Tests completed with exit code: ${testExitCode}`);

    // Run main application
    console.log('🏃 Running main application...');
    const appProcess = await this.notebook!.terminal.spawn('php', ['src/app.php']);

    const appReader = appProcess.output.getReader();
    try {
      while (true) {
        const { done, value } = await appReader.read();
        if (done) break;
        console.log('App:', value.trim());
      }
    } finally {
      appReader.releaseLock();
    }

    const appExitCode = await appProcess.exit;
    console.log(`✅ Application completed with exit code: ${appExitCode}`);
  }

  async demonstrateFileOperations(): Promise<void> {
    if (!this.notebook) return;

    console.log('📁 Demonstrating file operations...');

    // Find all PHP files
    const phpFiles = await this.notebook.file.find('*.php', {
      includes: ['src/**', 'tests/**'],
      excludes: ['vendor/**'],
      useIgnoreFiles: true,
      followSymlinks: false,
      useGlobalIgnoreFiles: false,
      useParentIgnoreFiles: false,
    });

    console.log(`Found ${phpFiles.length} PHP files:`);
    phpFiles.forEach((file) => console.log(`  - ${file.path}`));

    // Search for specific patterns
    const [hasMore, searchResults] = await this.notebook.file.search(
      {
        pattern: 'function',
        isRegExp: false,
        isCaseSensitive: false,
      },
      {
        maxResults: 10,
        includes: ['src/**'],
        excludes: ['vendor/**'],
        useIgnoreFiles: true,
        followSymlinks: false,
        useGlobalIgnoreFiles: false,
        useParentIgnoreFiles: false,
      }
    );

    console.log(`Found ${searchResults.length} function declarations${hasMore ? ' (showing first 10)' : ''}:`);
    searchResults.forEach((match) => {
      console.log(`  - ${match.path}:${match.lineNumber}: ${match.preview.text.trim()}`);
    });
  }

  async cleanup(): Promise<void> {
    if (this.notebook) {
      this.notebook.dispose();
      console.log('🧹 Cleaned up resources');
    }
  }
}

// Example usage
async function main() {
  const project = new BasicPhpProject(process.env.PHPSANDBOX_TOKEN!);

  try {
    const notebook = await project.createProject('My PHP Calculator');

    // Demonstrate file operations
    await project.demonstrateFileOperations();

    console.log('💡 Project is ready. Press Ctrl+C to stop.');

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await project.cleanup();
      process.exit(0);
    });

    // Keep the process alive and ping periodically
    setInterval(() => {
      notebook.ping().catch(() => {
        console.log('❌ Lost connection to notebook');
        process.exit(1);
      });
    }, 30000);
  } catch (error) {
    console.error('❌ Setup failed:', error);
    await project.cleanup();
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}
