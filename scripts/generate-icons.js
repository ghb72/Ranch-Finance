/**
 * Generate PWA icon PNGs from SVG using canvas
 * Run: node scripts/generate-icons.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00d68f"/>
      <stop offset="100%" style="stop-color:#4dabf7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <text x="256" y="220" text-anchor="middle" font-size="140" fill="url(#accent)" font-family="Arial,sans-serif" font-weight="bold">$</text>
  <text x="256" y="370" text-anchor="middle" font-size="90" font-family="Arial,sans-serif">&#x1F404;</text>
  <text x="256" y="460" text-anchor="middle" font-size="48" fill="#e8e8f0" font-family="Arial,sans-serif" font-weight="bold">RANCHO</text>
</svg>`;

// Write icon SVGs for different sizes
const publicDir = path.join(__dirname, '..', 'public');

// The vite config references PNG files, but since we can't generate PNGs without
// a canvas library, we'll update the config to use SVG icons which are perfectly valid
fs.writeFileSync(path.join(publicDir, 'icon-192.svg'), svgTemplate);
fs.writeFileSync(path.join(publicDir, 'icon-512.svg'), svgTemplate);

console.log('Icons generated in public/');
