const axios = require("axios").default;
const log = require("./utils/logger");

const REQUEST_TIMEOUT = 10000;

exports.UserInfoById = async function UserInfoById(userId) {
  try {
    const response = await axios.get(`https://users.roblox.com/v1/users/${encodeURIComponent(String(userId))}/`, {
      timeout: REQUEST_TIMEOUT,
    });
    return { status: "Success", success: true, data: response.data };
  } catch (err) {
    if (err.response?.status === 404) {
      return { status: "Invalid user ID", success: false, data: null };
    }
    return {
      status: err.response?.status
        ? `HTTP Error ${err.response.status}`
        : "Network error - Could not reach Roblox servers",
      success: false,
      data: null,
    };
  }
};

// --- Display info cache (username + avatar headshot) -----------------------

const DISPLAY_TTL_MS = 30 * 60 * 1000; // 30 min
const NEG_TTL_MS = 5 * 60 * 1000;       // 5 min for not-found
const MAX_CACHE_ENTRIES = 5_000;

const _displayCache = new Map();        // userId(string) -> { value, expires }

function _cacheGet(key) {
  const entry = _displayCache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    _displayCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function _cacheSet(key, value, ttl) {
  if (_displayCache.size >= MAX_CACHE_ENTRIES) {
    // Drop oldest (insertion-order Map)
    const firstKey = _displayCache.keys().next().value;
    if (firstKey !== undefined) _displayCache.delete(firstKey);
  }
  _displayCache.set(key, { value, expires: Date.now() + ttl });
}

function _isAllowedAvatarUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host.endsWith(".rbxcdn.com") || host.endsWith(".roblox.com");
  } catch {
    return false;
  }
}

async function _fetchAvatarHeadshot(userId) {
  try {
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(String(userId))}&size=150x150&format=Png&isCircular=false`;
    const res = await axios.get(url, { timeout: REQUEST_TIMEOUT });
    const item = res.data?.data?.[0];
    const candidate = item?.imageUrl;
    if (candidate && _isAllowedAvatarUrl(candidate)) return candidate;
    return null;
  } catch (err) {
    log.debug("Failed to fetch avatar:", err.message);
    return null;
  }
}

/**
 * Fetch combined display info for a Roblox user.
 * Returns null on permanent failure (not found / network).
 * Cached for 30 minutes.
 */
exports.getUserDisplayInfo = async function getUserDisplayInfo(userId) {
  if (userId === undefined || userId === null) return null;
  const key = String(userId);
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;

  const info = await exports.UserInfoById(userId);
  if (!info.success || !info.data) {
    _cacheSet(key, null, NEG_TTL_MS);
    return null;
  }

  const avatarUrl = await _fetchAvatarHeadshot(userId);
  const value = {
    userId: Number(userId),
    username: info.data.name || null,
    displayName: info.data.displayName || info.data.name || null,
    avatarUrl,
  };
  _cacheSet(key, value, DISPLAY_TTL_MS);
  return value;
};

/**
 * Resolve display info for many user IDs in parallel.
 * Returns Map<string-userId, displayInfo|null>.
 */
exports.getDisplayInfoMany = async function getDisplayInfoMany(userIds) {
  const unique = [...new Set(userIds.map(id => String(id)))];
  const results = await Promise.all(unique.map(id => exports.getUserDisplayInfo(id)));
  const map = new Map();
  for (let i = 0; i < unique.length; i++) map.set(unique[i], results[i]);
  return map;
};

// Format user as "DisplayName (@username) [id]" with safe fallbacks.
exports.formatUserLabel = function formatUserLabel(userId, info) {
  if (!info) return `\`${userId}\``;
  const display = info.displayName || info.username || String(userId);
  const username = info.username && info.username !== display ? ` (@${info.username})` : "";
  return `**${display}**${username} \`${userId}\``;
};
