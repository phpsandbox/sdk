import { PHPSandbox } from '../src/index.js';

const token = process.env.PHPSANDBOX_TOKEN;
if (!token) {
  throw new Error('Missing PHPSANDBOX_TOKEN');
}

const psb = new PHPSandbox(token);
const notebook = await psb.notebook.create('laravel');

console.log('====== Ping the notebook ======');
console.log('Response:', await notebook.ping());
console.log('====== Notebook is ready ======');

console.log('\n');

console.log('====== Read routes/web.php in the notebook ======');
const decoder = new TextDecoder();
const content = await notebook.file.readFile('routes/web.php');
console.log(decoder.decode(content));

// Always close the notebook when done to clean up the connection.
notebook.dispose();
await notebook.delete();
