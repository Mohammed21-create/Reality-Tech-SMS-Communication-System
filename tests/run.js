'use strict';
// Cross-platform test runner: node tests/run.js <unit|integration>
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const dir = path.join(__dirname, process.argv[2] || 'unit');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
