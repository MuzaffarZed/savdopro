import server from '../dist/server/server.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const req = new Request('http://localhost/');
  const res = await server.fetch(req);
  let html = await res.text();

  // Ensure relative assets or base href compatibility for GitHub Pages and WebView
  // Replace absolute /assets/ with ./assets/
  html = html.replaceAll('"/assets/', '"./assets/');
  html = html.replaceAll("'/assets/", "'./assets/");
  html = html.replaceAll('"/favicon.png"', '"./favicon.png"');
  html = html.replaceAll('"/manifest.json"', '"./manifest.json"');

  const clientDir = path.resolve('dist/client');
  if (!fs.existsSync(clientDir)) {
    fs.mkdirSync(clientDir, { recursive: true });
  }

  const indexPath = path.join(clientDir, 'index.html');
  const fallbackPath = path.join(clientDir, '404.html');

  fs.writeFileSync(indexPath, html, 'utf-8');
  fs.writeFileSync(fallbackPath, html, 'utf-8');

  console.log('✅ Successfully generated dist/client/index.html & 404.html with relative asset paths!');
}

main().catch((err) => {
  console.error('❌ Failed to generate HTML:', err);
  process.exit(1);
});
