
function validateGame(type, data) {
  const clean = (v) => typeof v === 'string' ? v.trim() : v;

  if (type === 'ff') {
    return /^\d{8,12}$/.test(clean(data.userId));
  }

  if (type === 'ml') {
    return Boolean(clean(data.userId)) && Boolean(clean(data.zoneId));
  }

  if (type === 'roblox') {
    const name = clean(data.username);
    return typeof name === 'string' && name.length >= 3;
  }

  return false;
}

module.exports = { validateGame };
