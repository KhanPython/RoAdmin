// Shared in-memory command history — used by both slash commands and NLP pipeline.
// Stores recent { action, parameters, source, timestamp } per (channel, user) pair.

const MAX_HISTORY = 20;
const MAX_HISTORY_KEYS = 10_000;
const history = new Map(); // `${channelId}:${userId}` → Array<Entry>

function pushHistory(channelId, userId, action, parameters, source = "slash") {
  const key = `${channelId}:${userId}`;
  if (!history.has(key) && history.size >= MAX_HISTORY_KEYS) return;
  if (!history.has(key)) history.set(key, []);
  const entries = history.get(key);
  entries.push({ action, parameters, source, timestamp: new Date().toISOString() });
  if (entries.length > MAX_HISTORY) entries.shift();
}

function getHistory(channelId, userId) {
  return history.get(`${channelId}:${userId}`) || [];
}

/** Return the most recently used value for a given parameter name, or undefined. */
function getLastParam(channelId, userId, paramName) {
  const entries = getHistory(channelId, userId);
  for (let i = entries.length - 1; i >= 0; i--) {
    const val = entries[i].parameters?.[paramName];
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

function clearUserHistory(userId) {
  let count = 0;
  const suffix = `:${userId}`;
  for (const [key, entries] of history) {
    if (key.endsWith(suffix)) {
      count += entries.length;
      history.delete(key);
    }
  }
  return count;
}

function clearChannelHistories(channelIds) {
  let count = 0;
  const channelSet = new Set(channelIds.map(String));
  for (const [key, entries] of history) {
    const channelId = key.split(":")[0];
    if (channelSet.has(channelId)) {
      count += entries.length;
      history.delete(key);
    }
  }
  return count;
}

module.exports = { pushHistory, getHistory, getLastParam, clearUserHistory, clearChannelHistories };
