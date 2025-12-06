# CDN Usage Guide

The PHPSandbox SDK is available via CDN for browser usage. Choose the format that best suits your needs.

## Using unpkg

### ES Module (Recommended for modern browsers)

```html
<script type="module">
  import * as PHPSandbox from 'https://unpkg.com/@phpsandbox/sdk/dist/browser/phpsandbox-sdk.esm.min.js';
  
  const client = new PHPSandbox.Client({
    apiKey: 'your-api-key'
  });
  
  // Use the SDK
  const instance = await client.notebook.start('your-notebook-id');
</script>
```

### IIFE (For direct script tags)

```html
<script src="https://unpkg.com/@phpsandbox/sdk/dist/browser/phpsandbox-sdk.iife.min.js"></script>
<script>
  const client = new PHPSandbox.Client({
    apiKey: 'your-api-key'
  });
  
  // Use the SDK
  client.notebook.start('your-notebook-id').then(instance => {
    console.log('Notebook started:', instance);
  });
</script>
```

## Using jsDelivr

### ES Module

```html
<script type="module">
  import * as PHPSandbox from 'https://cdn.jsdelivr.net/npm/@phpsandbox/sdk/dist/browser/phpsandbox-sdk.esm.min.js';
  
  const client = new PHPSandbox.Client({
    apiKey: 'your-api-key'
  });
</script>
```

### IIFE

```html
<script src="https://cdn.jsdelivr.net/npm/@phpsandbox/sdk/dist/browser/phpsandbox-sdk.iife.min.js"></script>
<script>
  const client = new PHPSandbox.Client({
    apiKey: 'your-api-key'
  });
</script>
```

## Version Pinning

It's recommended to pin to a specific version:

```html
<!-- unpkg -->
<script src="https://unpkg.com/@phpsandbox/sdk@0.0.1/dist/browser/phpsandbox-sdk.iife.min.js"></script>

<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/@phpsandbox/sdk@0.0.1/dist/browser/phpsandbox-sdk.iife.min.js"></script>
```

## Available Files

- `phpsandbox-sdk.esm.js` - ES Module (unminified, 140KB)
- `phpsandbox-sdk.esm.min.js` - ES Module (minified, 76KB)
- `phpsandbox-sdk.iife.js` - IIFE (unminified, 150KB)
- `phpsandbox-sdk.iife.min.js` - IIFE (minified, 76KB)

All files include source maps for debugging.

## Complete Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PHPSandbox SDK Demo</title>
</head>
<body>
  <h1>PHPSandbox SDK Browser Example</h1>
  <button id="start">Start Notebook</button>
  <pre id="output"></pre>

  <script type="module">
    import * as PHPSandbox from 'https://unpkg.com/@phpsandbox/sdk/dist/browser/phpsandbox-sdk.esm.min.js';
    
    const output = document.getElementById('output');
    const startBtn = document.getElementById('start');
    
    const client = new PHPSandbox.Client({
      apiKey: 'your-api-key',
      baseUrl: 'https://api.phpsandbox.io'
    });
    
    startBtn.addEventListener('click', async () => {
      try {
        output.textContent = 'Starting notebook...';
        const instance = await client.notebook.start('notebook-id');
        output.textContent = `Notebook started: ${instance.id}`;
        
        // Execute some PHP code
        const result = await instance.shell.exec('php -v');
        output.textContent += `\n\nPHP Version:\n${result.stdout}`;
      } catch (error) {
        output.textContent = `Error: ${error.message}`;
      }
    });
  </script>
</body>
</html>
```

## Notes

- The SDK requires a modern browser with ES2020 support
- WebSocket support is required for real-time features
- All dependencies are bundled in the CDN files
