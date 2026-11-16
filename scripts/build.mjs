// Cross-platform build: bundles the scripts, copies pdf.js, and generates panel.html from popup.html.
import { build } from 'esbuild';
import fs from 'fs';
const common = { bundle: true, minify: true, format: 'iife', platform: 'browser', logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/content.src.js'], outfile: 'content.js' });
await build({ ...common, entryPoints: ['src/background.src.js'], outfile: 'background.js' });
await build({ ...common, entryPoints: ['src/pdfcheck.js'], outfile: 'pdfcheck.js', globalName: 'TCPDF' });
fs.mkdirSync('vendor', { recursive: true });
for (const f of ['pdf.min.js', 'pdf.worker.min.js']) fs.copyFileSync(`node_modules/pdfjs-dist/build/${f}`, `vendor/${f}`);
fs.copyFileSync('node_modules/pdfjs-dist/LICENSE', 'vendor/pdfjs-LICENSE.txt');
fs.writeFileSync('panel.html', fs.readFileSync('popup.html', 'utf8').replace('<body>', '<body class="panel">'));
console.log('built: content.js, background.js, pdfcheck.js, panel.html');
