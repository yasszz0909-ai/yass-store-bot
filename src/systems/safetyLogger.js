
function log(action, data) {
  console.log('[SAFE_LOG]', action, data || '');
}

module.exports = { log };
