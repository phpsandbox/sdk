import { PHPSandbox } from '../src/index.js';

const psb = new PHPSandbox('api-token-here');
const notebook = await psb.notebook.open('laravel');

console.log('====== Ping the notebook ======');
console.log('Response:', await notebook.ping());
console.log('====== Notebook is ready ======');

console.log('\n');

console.log('====== Read routes/web.php in the notebook ======');
const decoder = new TextDecoder();
const content = await notebook.file.readFile('routes/web.php');
console.log(decoder.decode(content));

/**
 * Important: Always close the notebook when done to clean up connection.
 */
notebook.dispose();
