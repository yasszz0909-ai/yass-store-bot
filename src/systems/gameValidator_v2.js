
function validateGame(type, data) {
  const clean = (v) => typeof v === 'string' ? v.trim() : v;

  if (type === 'ff') {
    return /^\d{8,12}$/.test(clean(data.userId));
  }

  if (type === 'ml') {
    return data.userId && data.zoneId;
  }

  if (type === 'roblox') {
    return clean(data.username)?.length >= 3;
  }

  return false;
}

module.exports = { validateGame };
