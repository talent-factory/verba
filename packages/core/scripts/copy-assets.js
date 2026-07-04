// Copies non-TS assets into dist/ after tsc (tsc emits JS only).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'config', 'defaultTemplates.json');
const destDir = path.join(__dirname, '..', 'dist', 'config');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'defaultTemplates.json'));
