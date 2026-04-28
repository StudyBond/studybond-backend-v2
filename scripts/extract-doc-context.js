const fs = require('fs');

const [, , filePath, keyword = 'leaderboard', radiusArg = '8'] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/extract-doc-context.js <file-path> [keyword] [radius]');
  process.exit(1);
}

const radius = Number.parseInt(radiusArg, 10);
const text = fs.readFileSync(filePath, 'utf8');
const lines = text.split(/\r?\n/);
const matcher = new RegExp(keyword, 'i');
let found = 0;

for (let i = 0; i < lines.length; i += 1) {
  if (!matcher.test(lines[i])) continue;
  found += 1;
  const start = Math.max(0, i - radius);
  const end = Math.min(lines.length, i + radius + 1);
  console.log(`--- ${filePath} line ${i + 1} ---`);
  for (let j = start; j < end; j += 1) {
    console.log(`${j + 1}: ${lines[j]}`);
  }
}

if (found === 0) {
  console.log(`No matches for "${keyword}" in ${filePath}`);
}
