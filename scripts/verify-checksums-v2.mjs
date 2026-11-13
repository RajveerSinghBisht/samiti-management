import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_V2_DIR = path.resolve(process.cwd(), 'tests', 'acceptance_v2');
const CHECKSUM_FILE = path.join(ACCEPTANCE_V2_DIR, 'checksums.sha256');

function listAcceptanceV2Files() {
  if (!fs.existsSync(ACCEPTANCE_V2_DIR)) return [];
  return fs
    .readdirSync(ACCEPTANCE_V2_DIR)
    .filter((f) => f !== 'checksums.sha256' && (f.endsWith('.ts') || f.endsWith('.tsx')))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function sha256Normalized(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

const mode = process.argv[2] || 'verify';

if (mode === 'generate') {
  const files = listAcceptanceV2Files();
  const lines = files.map((file) => {
    const hash = sha256Normalized(path.join(ACCEPTANCE_V2_DIR, file));
    return `${hash}  ${file}`;
  });
  fs.writeFileSync(CHECKSUM_FILE, lines.join('\n') + '\n', 'utf8');
  console.log(`Generated ${lines.length} checksums in tests/acceptance_v2/checksums.sha256`);
} else {
  if (!fs.existsSync(CHECKSUM_FILE)) {
    console.error('Missing tests/acceptance_v2/checksums.sha256');
    process.exit(1);
  }
  const expected = new Map();
  const lines = fs
    .readFileSync(CHECKSUM_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!match) {
      console.error(`Malformed checksum line: ${line}`);
      process.exit(1);
    }
    expected.set(match[2], match[1]);
  }

  const actualFiles = listAcceptanceV2Files();
  if (actualFiles.length !== expected.size) {
    console.error(
      `File count mismatch: expected ${expected.size}, found ${actualFiles.length}`
    );
    process.exit(1);
  }
  for (const file of actualFiles) {
    const actualHash = sha256Normalized(path.join(ACCEPTANCE_V2_DIR, file));
    const expectedHash = expected.get(file);
    if (actualHash !== expectedHash) {
      console.error(`Checksum mismatch for ${file}: expected ${expectedHash}, got ${actualHash}`);
      process.exit(1);
    }
  }
  console.log(`Verified ${actualFiles.length} locked acceptance_v2 test files.`);
}

