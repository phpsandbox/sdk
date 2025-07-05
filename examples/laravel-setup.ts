/**
 * Laravel Application Setup Example
 *
 * This example demonstrates how to create a complete Laravel application
 * with authentication, database setup, and API endpoints.
 */

import { PHPSandbox, NotebookInstance } from '@phpsandbox/sdk';

interface LaravelSetupOptions {
  projectName: string;
  installPackages?: string[];
  setupAuth?: boolean;
  createApiRoutes?: boolean;
  runMigrations?: boolean;
}

export class LaravelSetup {
  private client: PHPSandbox;
  private notebook: NotebookInstance | null = null;

  constructor(token: string) {
    this.client = new PHPSandbox(token);
  }

  async createLaravelApp(options: LaravelSetupOptions): Promise<NotebookInstance> {
    console.log('🚀 Creating Laravel application...');

    // Create notebook from Laravel template
    this.notebook = await this.client.notebook.create('laravel');
    await this.notebook.ready();

    console.log('✅ Laravel notebook ready');

    // Set up project structure
    await this.setupProjectStructure(options);

    // Install additional packages
    if (options.installPackages && options.installPackages.length > 0) {
      await this.installPackages(options.installPackages);
    }

    // Set up authentication
    if (options.setupAuth) {
      await this.setupAuthentication();
    }

    // Create API routes
    if (options.createApiRoutes) {
      await this.createApiRoutes();
    }

    // Run migrations
    if (options.runMigrations) {
      await this.runMigrations();
    }

    // Set up Git repository
    await this.setupGitRepository();

    // Start development server
    await this.startDevelopmentServer();

    console.log('🎉 Laravel application setup complete!');
    return this.notebook;
  }

  private async setupProjectStructure(options: LaravelSetupOptions): Promise<void> {
    console.log('📁 Setting up project structure...');

    // Update .env file
    const envContent = `
APP_NAME="${options.projectName}"
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8000

LOG_CHANNEL=stack
LOG_DEPRECATIONS_CHANNEL=null
LOG_LEVEL=debug

DB_CONNECTION=sqlite
DB_DATABASE=/app/database/database.sqlite

BROADCAST_DRIVER=log
CACHE_DRIVER=file
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120
`;

    await this.notebook!.file.writeFile('.env', new TextEncoder().encode(envContent.trim()), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Create SQLite database
    await this.notebook!.terminal.spawn('touch', ['database/database.sqlite']);

    // Generate application key
    await this.notebook!.laravel.artisan('key:generate');

    console.log('✅ Project structure configured');
  }

  private async installPackages(packages: string[]): Promise<void> {
    console.log(`📦 Installing packages: ${packages.join(', ')}`);

    await this.notebook!.composer.install(packages);

    console.log('✅ Packages installed');
  }

  private async setupAuthentication(): Promise<void> {
    console.log('🔐 Setting up authentication...');

    // Install Laravel Sanctum
    await this.notebook!.composer.install(['laravel/sanctum']);

    // Publish Sanctum configuration
    await this.notebook!.laravel.artisan('vendor:publish', ['--provider=Laravel\\Sanctum\\SanctumServiceProvider']);

    // Create authentication controllers
    await this.notebook!.laravel.make('controller', 'AuthController');

    // Create auth controller content
    const authControllerContent = `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;
use Illuminate\\Http\\Request;
use Illuminate\\Http\\Response;
use Illuminate\\Support\\Facades\\Hash;
use Illuminate\\Validation\\ValidationException;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
        ]);

        $token = $user->createToken('auth-token')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token,
        ], 201);
    }

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        $token = $user->createToken('auth-token')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token,
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out successfully']);
    }

    public function user(Request $request)
    {
        return response()->json($request->user());
    }
}
`;

    await this.notebook!.file.writeFile(
      'app/Http/Controllers/AuthController.php',
      new TextEncoder().encode(authControllerContent),
      { create: true, overwrite: true, unlock: false, atomic: false }
    );

    console.log('✅ Authentication setup complete');
  }

  private async createApiRoutes(): Promise<void> {
    console.log('🛣️  Creating API routes...');

    const apiRoutesContent = `<?php

use App\\Http\\Controllers\\AuthController;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

// Public routes
Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);

// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // Example protected routes
    Route::get('/dashboard', function () {
        return response()->json(['message' => 'Welcome to the dashboard!']);
    });

    Route::apiResource('posts', \\App\\Http\\Controllers\\PostController::class);
});

// Health check
Route::get('/health', function () {
    return response()->json([
        'status' => 'healthy',
        'timestamp' => now(),
        'version' => '1.0.0'
    ]);
});
`;

    await this.notebook!.file.writeFile('routes/api.php', new TextEncoder().encode(apiRoutesContent), {
      create: true,
      overwrite: true,
      unlock: false,
      atomic: false,
    });

    // Create a sample Post model and controller
    await this.notebook!.laravel.make('model', 'Post', { migration: true });
    await this.notebook!.laravel.make('controller', 'PostController', { resource: true, api: true });

    console.log('✅ API routes created');
  }

  private async runMigrations(): Promise<void> {
    console.log('🗄️  Running database migrations...');

    await this.notebook!.laravel.migrate();

    console.log('✅ Migrations completed');
  }

  private async setupGitRepository(): Promise<void> {
    console.log('📝 Setting up Git repository...');

    // Initialize Git repository
    await this.notebook!.git.init();

    // Create .gitignore if it doesn't exist
    const gitignoreExists = await this.notebook!.file.exists('.gitignore');
    if (!gitignoreExists) {
      const gitignoreContent = `/node_modules
/public/hot
/public/storage
/storage/*.key
/vendor
.env
.env.backup
.phpunit.result.cache
docker-compose.override.yml
Homestead.json
Homestead.yaml
npm-debug.log
yarn-error.log
/.idea
/.vscode`;

      await this.notebook!.file.writeFile('.gitignore', new TextEncoder().encode(gitignoreContent), {
        create: true,
        overwrite: false,
        unlock: false,
        atomic: false,
      });
    }

    // Add all files
    await this.notebook!.git.add(['.']);

    // Initial commit
    await this.notebook!.git.commit('Initial Laravel application setup');

    console.log('✅ Git repository initialized');
  }

  private async startDevelopmentServer(): Promise<void> {
    console.log('🚀 Starting development server...');

    // Start Laravel development server
    const server = await this.notebook!.terminal.spawn('php', ['artisan', 'serve', '--host=0.0.0.0', '--port=8000']);

    // Monitor for server startup
    this.notebook!.container.onPort((port, type) => {
      if (type === 'open' && port.port === 8000) {
        console.log(`🌐 Laravel server available at: ${port.url}`);
        console.log('API endpoints:');
        console.log(`  - POST ${port.url}/api/register`);
        console.log(`  - POST ${port.url}/api/login`);
        console.log(`  - GET  ${port.url}/api/user (protected)`);
        console.log(`  - GET  ${port.url}/api/health`);
      }
    });

    // Don't await the server process as it runs indefinitely
    console.log('✅ Development server started');
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
  const setup = new LaravelSetup(process.env.PHPSANDBOX_TOKEN!);

  try {
    const notebook = await setup.createLaravelApp({
      projectName: 'My Laravel API',
      installPackages: ['laravel/sanctum', 'laravel/tinker', 'spatie/laravel-query-builder'],
      setupAuth: true,
      createApiRoutes: true,
      runMigrations: true,
    });

    // Keep the process running to maintain the server
    console.log('💡 Laravel application is running. Press Ctrl+C to stop.');

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await setup.cleanup();
      process.exit(0);
    });

    // Keep the process alive
    setInterval(() => {
      // Check if notebook is still connected
      notebook.ping().catch(() => {
        console.log('❌ Lost connection to notebook');
        process.exit(1);
      });
    }, 30000);
  } catch (error) {
    console.error('❌ Setup failed:', error);
    await setup.cleanup();
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

export { LaravelSetup };
