const fs = require('fs');
const path = require('path');

/**
 * Safe JSON persistence layer.
 * - Atomic writes (temp file + rename) so a crash mid-write never corrupts data.
 * - Per-file async lock so concurrent read-modify-write operations cannot
 *   interleave and lose data.
 */
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const locks = new Map(); // file -> tail Promise

const filePath = (file) => path.join(DATA_DIR, file);

function readSync(file, fallback) {
  try {
    const raw = fs.readFileSync(filePath(file), 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeSync(file, data) {
  const target = filePath(file);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
  return data;
}

/**
 * Serialize an async operation against a file so read-modify-write stays atomic.
 */
function withLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(file, run.then(() => {}, () => {}));
  return run;
}

/**
 * Atomic read-modify-write. The mutator receives the current data and either
 * mutates it in place or returns a new value to persist.
 */
function update(file, fallback, mutator) {
  return withLock(file, async () => {
    const data = readSync(file, fallback);
    const result = await mutator(data);
    return writeSync(file, result === undefined ? data : result);
  });
}

module.exports = { DATA_DIR, filePath, readSync, writeSync, withLock, update };
