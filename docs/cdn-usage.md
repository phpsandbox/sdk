# CDN Usage Guide

The SDK ships browser bundles under `dist/browser`.

## Security First

Do not hardcode long-lived private API tokens in public frontend code. Use short-lived tokens issued by your backend.

## ESM in Browsers

### unpkg

```html
<script type="module">
  import { PHPSandbox } from 'https://unpkg.com/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.esm.min.js';

  const client = new PHPSandbox('your-short-lived-token');
  const notebook = await client.notebook.open('your-notebook-id');
  await notebook.ready();

  const result = await notebook.shell.exec('php -v');
  result.throw();
  console.log(result.output);
</script>
```

### jsDelivr

```html
<script type="module">
  import { PHPSandbox } from 'https://cdn.jsdelivr.net/npm/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.esm.min.js';

  const client = new PHPSandbox('your-short-lived-token');
</script>
```

## Script Tag (IIFE)

### unpkg

```html
<script src="https://unpkg.com/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.iife.min.js"></script>
<script>
  const client = new PHPSandbox.PHPSandbox('your-short-lived-token');

  client.notebook.open('your-notebook-id').then(async (notebook) => {
    await notebook.ready();
    const result = await notebook.shell.exec('php -v');
    console.log(result.output);
    notebook.dispose();
  });
</script>
```

### jsDelivr

```html
<script src="https://cdn.jsdelivr.net/npm/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.iife.min.js"></script>
```

## Version Pinning

Always pin a version in production URLs:

```html
https://unpkg.com/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.esm.min.js
https://cdn.jsdelivr.net/npm/@phpsandbox/sdk@0.0.16/dist/browser/phpsandbox-sdk.iife.min.js
```

## Bundle Files

- `phpsandbox-sdk.esm.js`
- `phpsandbox-sdk.esm.min.js`
- `phpsandbox-sdk.iife.js`
- `phpsandbox-sdk.iife.min.js`

## Browser Requirements

- ES2020-compatible runtime
- `fetch`, `WebSocket`, and `ReadableStream` support
