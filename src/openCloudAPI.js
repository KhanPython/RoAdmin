const axios = require("axios").default;
const { OpenCloud, DataStoreService } = require("rbxcloud");
const apiCache = require("./utils/apiCache");
const log = require("./utils/logger");
const { robloxLimiter } = require("./utils/rateLimiter");

axios.defaults.timeout = 10000;

// Returns an error response if limit exceeded, or null if allowed
function checkLimit(universeId) {
  const { allowed, retryAfter } = robloxLimiter.check(`universe:${universeId}`);
  if (!allowed) {
    const secs = Math.ceil(retryAfter / 1000);
    log.warn(`Rate limit hit for universe ${universeId} - retry in ${secs}s`);
    return createDataStoreErrorResponse(
      "RateLimit",
      `Rate limit reached for this universe. Try again in ${secs}s.`
    );
  }
  return null;
}

exports.GetDataStoreEntry = async function (key, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    if (!datastoreName) {
      throw new Error("Datastore name is required");
    }
    if (!key) {
      throw new Error("Entry key is required");
    }
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }

    // Use REST API directly with the correct endpoint format
    // The endpoint should be: /universes/{id}/data-stores/{name}/scopes/{scope}/entries/{entryKey}
    const encodedKey = encodeURIComponent(key);
    const path = `universes/${universeId}/data-stores/${datastoreName}/scopes/global/entries/${encodedKey}`;
    const url = `https://apis.roblox.com/cloud/v2/${path}`;

    log.debug(`GetDataStoreEntry - URL: ${url}`);
    log.debug(`GetDataStoreEntry - Key: ${key}, Encoded: ${encodedKey}`);

    const response = await axios.get(url, {
      headers: getApiHeaders(universeId),
    });

    log.debug(`GetDataStoreEntry - Response status: ${response.status}`);

    if (response.status === 200) {
      // Check if response is an array (this means we got a list, not a single entry)
      if (Array.isArray(response.data)) {
        log.debug(`GetDataStoreEntry - Received List/Array. Searching for key "${key}"`);
        // The API returned a list of entries (likely prefix match). We need to find the EXACT entry with ID matching our key.
        const entry = response.data.find(e => e.id === key);
        if (entry) {
          // Now fetch the actual value from the entry path
          try {
            const valueUrl = `https://apis.roblox.com/cloud/v2/${entry.path}`;
            log.debug(`Fetching actual value from: ${valueUrl}`);
            const valueResponse = await axios.get(valueUrl, {
              headers: getApiHeaders(universeId),
            });
            
            let data = valueResponse.data;
            
            // Try to parse JSON if it's a string
            if (typeof data === 'string') {
              try {
                data = JSON.parse(data);
              } catch (e) {
                // Keep as string if not valid JSON
              }
            }
            
            return createSuccessResponse({ data });
          } catch (valueError) {
            log.error("Failed to fetch value:", valueError.message);
            return createDataStoreErrorResponse("GetDataStoreEntry", `Found key but failed to fetch value: ${valueError.message}`, { data: null });
          }
        }
        return createDataStoreErrorResponse("GetDataStoreEntry", `Key "${key}" not found in datastore.`, { data: null });
      }

      // The API response should contain the value directly
      let data = response.data;
      
      // If the response has a 'value' property, use that
      if (response.data && response.data.value !== undefined) {
        data = response.data.value;
      }

      // Try to parse JSON if it's a string
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          // If it's not valid JSON, keep it as a string
        }
      }
      
      return createSuccessResponse({ data });
    }
    return createDataStoreErrorResponse("GetDataStoreEntry", `Unexpected status: ${response.status}`, { data: null });
  } catch (error) {
    log.error(`Error getting data for key ${key}:`, error.message);
    // Return empty data rather than erroring out, in case entry doesn't exist
    if (error.response?.status === 404) {
      return createSuccessResponse({ data: null });
    }
    
    // Create a safe error message (truncate if too long)
    let errorMsg = error.message || "Unknown error";
    if (errorMsg.length > 200) {
      errorMsg = errorMsg.substring(0, 197) + "...";
    }
    
    return createDataStoreErrorResponse("GetDataStoreEntry", errorMsg, { data: null });
  }
};

exports.GetPlayerData = async function (userId, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }

    // Use REST API directly instead of DataStoreService
    const path = `universes/${universeId}/data-stores/${datastoreName}/scopes/global/entries`;
    const url = new URL(`https://apis.roblox.com/cloud/v2/${path}`);
    url.searchParams.append('entryKey', `player_${userId}`);

    const response = await axios.get(url.toString(), {
      headers: getApiHeaders(universeId),
    });

    if (response.status === 200) {
      const data = response.data;
      return createSuccessResponse({ data });
    }
    return createDataStoreErrorResponse("GetPlayerData", `Unexpected status: ${response.status}`, { data: null });
  } catch (error) {
    log.error(`Error getting data for user ${userId}:`, error.message);
    // Return empty data rather than erroring out, in case entry doesn't exist
    if (error.response?.status === 404) {
      return createSuccessResponse({ data: null });
    }
    return createDataStoreErrorResponse("GetPlayerData", error.message, { data: null });
  }
};

exports.SetPlayerData = async function (userId, value, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }

    // Use REST API directly instead of DataStoreService
    const path = `universes/${universeId}/data-stores/${datastoreName}/scopes/global/entries`;
    const url = new URL(`https://apis.roblox.com/cloud/v2/${path}`);
    url.searchParams.append('entryKey', `player_${userId}`);

    const response = await axios.post(url.toString(), value, {
      headers: {
        ...getApiHeaders(universeId),
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200 || response.status === 201) {
      return createSuccessResponse();
    }
    return createDataStoreErrorResponse("SetPlayerData", `Unexpected status: ${response.status}`);
  } catch (error) {
    log.error(`Error setting data for user ${userId}:`, error.message);
    return createDataStoreErrorResponse("SetPlayerData", error.message);
  }
};

exports.IncrementPlayerData = async function (userId, amount, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const [newValue, keyInfo] = await datastore.IncrementAsync(`player_${userId}`, amount);
    return createSuccessResponse({ newValue });
  } catch (error) {
    log.error(`Error incrementing data for user ${userId}:`, error.message);
    return createDataStoreErrorResponse("IncrementPlayerData", error.message, { newValue: null });
  }
};

exports.UpdatePlayerData = async function (userId, updateFunction, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const newValue = await datastore.UpdateAsync(`player_${userId}`, updateFunction);
    return createSuccessResponse({ newValue });
  } catch (error) {
    log.error(`Error updating data for user ${userId}:`, error.message);
    return createDataStoreErrorResponse("UpdatePlayerData", error.message, { newValue: null });
  }
};

exports.RemovePlayerData = async function (userId, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const oldValue = await datastore.RemoveAsync(`player_${userId}`);
    return createSuccessResponse({ oldValue });
  } catch (error) {
    log.error(`Error removing data for user ${userId}:`, error.message);
    return createDataStoreErrorResponse("RemovePlayerData", error.message, { oldValue: null });
  }
};

exports.ListOrderedDataStoreEntries = async function (orderedDatastoreName, scopeId = "global", pageToken = null, universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }
    
    // Construct the correct Open Cloud API path for listing ordered data stores
    const path = `universes/${universeId}/ordered-data-stores/${orderedDatastoreName}/scopes/${scopeId}/entries`;
    const url = new URL(`https://apis.roblox.com/cloud/v2/${path}`);
    url.searchParams.append('orderBy', 'value desc');
    
    if (pageToken) {
      url.searchParams.append('pageToken', pageToken);
    }
    
    const response = await axios.get(url.toString(), {
      headers: getApiHeaders(universeId),
    });

    log.debug("ListOrderedDataStoreEntries response keys:", Object.keys(response.data));

    // Check different possible response structures
    const entries = response.data.orderedDataStoreEntries || response.data.dataStoreEntries || response.data.entries || [];
    const nextPageToken = response.data.nextPageToken || null;

    return createSuccessResponse({ entries: Array.isArray(entries) ? entries : [], nextPageToken });
  } catch (error) {
    log.error("Error listing ordered datastore entries:", error.message);
    const status = error.response?.status;
    if (status === 404) {
      return createDataStoreErrorResponse("ListOrderedDataStoreEntries", "Ordered datastore or scope not found");
    }
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("ListOrderedDataStoreEntries", errorMsg);
  }
};

exports.RemoveOrderedDataStoreData = async function (userId, orderedDatastoreName, key = null, scopeId = "global", universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }
    const keyToRemove = key ? String(key) : String(userId);
    const encodedName = encodeURIComponent(orderedDatastoreName);
    const encodedKey = encodeURIComponent(keyToRemove);

    const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/ordered-data-stores/${encodedName}/scopes/${scopeId}/entries/${encodedKey}`;

    const response = await axios.delete(url, {
      headers: getApiHeaders(universeId),
    });

    if (response.status === 200 || response.status === 204) {
      return createSuccessResponse({ message: `Removed entry "${keyToRemove}" from ordered datastore "${orderedDatastoreName}"` });
    }

    return createDataStoreErrorResponse("RemoveOrderedDataStoreData", `Unexpected response status: ${response.status}`);
  } catch (error) {
    log.error(`Error removing ordered datastore data for user ${userId}:`, error.message);
    
    if (error.response?.status === 404) {
      return createDataStoreErrorResponse("RemoveOrderedDataStoreData", "Key not found in ordered datastore");
    }
    const status = error.response?.status;
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("RemoveOrderedDataStoreData", errorMsg);
  }
};

exports.CheckOrderedDataStoreKey = async function (keyToFind, orderedDatastoreName, scopeId = "global", universeId = null) {
  try {
    let pageToken = null;
    let pageCount = 0;
    
    while (true) {
      pageCount++;
      
      const response = await exports.ListOrderedDataStoreEntries(orderedDatastoreName, scopeId, pageToken, universeId);
      
      if (!response.success) {
        return { exists: false, entry: null, message: `Error fetching page: ${response.status}` };
      }
      
      const entries = response.entries || [];
      
      // Check if key exists on this page
      const found = entries.find(e => e.id === keyToFind);
      if (found) {
        return { exists: true, entry: found, message: `Found on page ${pageCount}` };
      }
      
      // Check for next page
      if (!response.nextPageToken) {
        return { exists: false, entry: null, message: `Key not found after checking ${pageCount} pages` };
      }
      
      pageToken = response.nextPageToken;
    }
  } catch (error) {
    log.error("Error checking ordered datastore key:", error.message);
    return { exists: false, entry: null, message: `Error: ${error.message}` };
  }
};

exports.BanUser = async function (userId, reason, duration, excludeAltAccounts = false, universeId = null, discordUserId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    let durationSeconds = null;
    let expiresDate = null;
    let durationString = null;

    if (duration) {
      durationSeconds = parseDuration(duration);
      expiresDate = new Date(Date.now() + durationSeconds * 1000);
      durationString = `${durationSeconds}s`;
    }

    const privateReason = discordUserId
      ? `${reason} | Banned by Discord user ${discordUserId}`
      : reason;

    const payload = {
      gameJoinRestriction: {
        active: true,
        privateReason,
        displayReason: reason,
        excludeAltAccounts: excludeAltAccounts || false,
      }
    };

    if (durationString) {
      payload.gameJoinRestriction.duration = durationString;
    }

    const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
    const response = await axios.patch(url, payload, { headers: getApiHeaders(universeId) });

    if (response.status === 200) {
      return createSuccessResponse({ expiresDate });
    }
    return createDataStoreErrorResponse("BanUser", "Unknown error occurred", { expiresDate: null });
  } catch (error) {
    logError("BAN", error);
    const status = error.response?.status;

    if (status === 429) {
      return createDataStoreErrorResponse("BanUser", `User ${userId} was recently modified. Please wait a moment before trying again.`, { expiresDate: null });
    }
    if (status === 409) {
      return createDataStoreErrorResponse("BanUser", `User ${userId} already has an active ban`, { expiresDate: null });
    }

    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("BanUser", errorMsg, { expiresDate: null });
  }
};

exports.UnbanUser = async function (userId, universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const payload = { gameJoinRestriction: { active: false } };
    const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;

    const response = await axios.patch(url, payload, { headers: getApiHeaders(universeId) });

    if (response.status === 200) {
      return createSuccessResponse();
    }
    return createDataStoreErrorResponse("UnbanUser", "Failed to unban user");
  } catch (error) {
    logError("UNBAN", error);
    const status = error.response?.status;
    
    if (status === 404) {
      return createDataStoreErrorResponse("UnbanUser", `User ${userId} has no active ban`);
    }

    if (status === 429) {
      return createDataStoreErrorResponse("UnbanUser", `User ${userId} is already unbanned or the request was rate-limited. Please wait a moment before trying again.`);
    }
    
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("UnbanUser", errorMsg);
  }
};

exports.CheckBanStatus = async function (userId, universeId) {
  try {
    if (!universeId) throw new Error("Universe ID is required");
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
    const response = await axios.get(url, { headers: getApiHeaders(universeId) });
    if (response.status === 200) {
      const restriction = response.data.gameJoinRestriction ?? {};
      const active = restriction.active ?? false;
      let expiresDate = null;
      if (active && restriction.duration && restriction.startTime) {
        const durationSeconds = parseInt(restriction.duration, 10);
        expiresDate = new Date(new Date(restriction.startTime).getTime() + durationSeconds * 1000);
      }
      return createSuccessResponse({
        active,
        reason: restriction.displayReason || restriction.privateReason || null,
        startTime: restriction.startTime ? new Date(restriction.startTime) : null,
        expiresDate,
        excludeAltAccounts: restriction.excludeAltAccounts ?? false,
      });
    }
    return createDataStoreErrorResponse("CheckBanStatus", `Unexpected status: ${response.status}`);
  } catch (error) {
    logError("CHECK_BAN", error);
    const status = error.response?.status;
    if (status === 404) {
      return createSuccessResponse({ active: false, reason: null, startTime: null, expiresDate: null, excludeAltAccounts: false });
    }
    return createDataStoreErrorResponse("CheckBanStatus", getHttpErrorMessage(status) || error.message);
  }
};

exports.ListBans = async function (universeId, pageToken = null) {
  try {
    if (!universeId) throw new Error("Universe ID is required");
    const limited = checkLimit(universeId);
    if (limited) return limited;
    const url = new URL(`https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions`);
    url.searchParams.set("filter", "gameJoinRestriction.active==true");
    url.searchParams.set("maxPageSize", "10");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await axios.get(url.toString(), { headers: getApiHeaders(universeId) });
    if (response.status === 200) {
      return createSuccessResponse({
        bans: response.data.userRestrictions || [],
        nextPageToken: response.data.nextPageToken || null,
      });
    }
    return createDataStoreErrorResponse("ListBans", `Unexpected status: ${response.status}`);
  } catch (error) {
    logError("LIST_BANS", error);
    const status = error.response?.status;
    return createDataStoreErrorResponse("ListBans", getHttpErrorMessage(status) || error.message);
  }
};

exports.SetDataStoreEntry = async function (key, value, universeId, datastoreName, scope = "global") {
  try {
    if (!universeId) throw new Error("Universe ID is required");
    const limited = checkLimit(universeId);
    if (limited) return limited;
    if (!datastoreName) throw new Error("Datastore name is required");
    if (!key) throw new Error("Entry key is required");
    const encodedKey = encodeURIComponent(key);
    const entryUrl = `https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/${datastoreName}/scopes/${scope}/entries/${encodedKey}`;
    try {
      const response = await axios.patch(entryUrl, { value }, { headers: getApiHeaders(universeId) });
      if (response.status === 200 || response.status === 201) return createSuccessResponse();
    } catch (patchErr) {
      if (patchErr.response?.status !== 404) throw patchErr;
      // Key doesn't exist yet - create it
      const createUrl = new URL(`https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/${datastoreName}/scopes/${scope}/entries`);
      createUrl.searchParams.set("id", key);
      const postResponse = await axios.post(createUrl.toString(), { value }, { headers: getApiHeaders(universeId) });
      if (postResponse.status === 200 || postResponse.status === 201) return createSuccessResponse();
    }
    return createDataStoreErrorResponse("SetDataStoreEntry", "Unexpected response from API");
  } catch (error) {
    logError("SET_DATA", error);
    const status = error.response?.status;
    return createDataStoreErrorResponse("SetDataStoreEntry", getHttpErrorMessage(status) || error.message);
  }
};

exports.ListDataStoreKeys = async function (universeId, datastoreName, scope = "global", pageToken = null) {
  try {
    if (!universeId) throw new Error("Universe ID is required");
    const limited = checkLimit(universeId);
    if (limited) return limited;
    if (!datastoreName) throw new Error("Datastore name is required");
    const url = new URL(`https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/${datastoreName}/scopes/${scope}/entries`);
    url.searchParams.set("maxPageSize", "20");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await axios.get(url.toString(), { headers: getApiHeaders(universeId) });
    if (response.status === 200) {
      const raw = response.data.dataStoreEntries || response.data.entries || [];
      const keys = raw.map(e => e.id || e.path?.split("/").pop() || "?");
      return createSuccessResponse({ keys, nextPageToken: response.data.nextPageToken || null });
    }
    return createDataStoreErrorResponse("ListDataStoreKeys", `Unexpected status: ${response.status}`);
  } catch (error) {
    logError("LIST_KEYS", error);
    const status = error.response?.status;
    return createDataStoreErrorResponse("ListDataStoreKeys", getHttpErrorMessage(status) || error.message);
  }
};

exports.DeleteDataStoreEntry = async function (key, universeId, datastoreName, scope = "global") {
  try {
    if (!universeId) throw new Error("Universe ID is required");
    const limited = checkLimit(universeId);
    if (limited) return limited;
    if (!datastoreName) throw new Error("Datastore name is required");
    if (!key) throw new Error("Entry key is required");
    const encodedKey = encodeURIComponent(key);
    const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/${datastoreName}/scopes/${scope}/entries/${encodedKey}`;
    const response = await axios.delete(url, { headers: getApiHeaders(universeId) });
    if (response.status === 200 || response.status === 204) return createSuccessResponse();
    return createDataStoreErrorResponse("DeleteDataStoreEntry", `Unexpected status: ${response.status}`);
  } catch (error) {
    logError("DELETE_DATA", error);
    const status = error.response?.status;
    if (status === 404) return createDataStoreErrorResponse("DeleteDataStoreEntry", `Key "${key}" not found in datastore`);
    return createDataStoreErrorResponse("DeleteDataStoreEntry", getHttpErrorMessage(status) || error.message);
  }
};

function getApiHeaders(universeId) {
  const apiKey = apiCache.getApiKey(universeId);
  if (!apiKey) {
    throw new Error(`API key not found in cache for universe ${universeId}. Use /setapikey command to set it.`);
  }
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

function getHttpErrorMessage(status) {
  switch (status) {
    case 400:
      return "Invalid request - Check your input";
    case 401:
      return "Invalid API key";
    case 403:
      return "Access denied - Check API key permissions";
    case 404:
      return "Not found - Invalid universe ID or user";
    case 409:
      return "Conflict - This action was already applied";
    case 429:
      return "Rate limited - Please wait a moment before trying again";
    case 500:
      return "Roblox server error - Try again later";
    case 502:
      return "Roblox server unavailable - Try again later";
    case 503:
      return "Roblox service temporarily unavailable - Try again later";
    default:
      return status ? `HTTP Error ${status}` : "Network error - Could not reach Roblox servers";
  }
}

function createDataStoreErrorResponse(operation, message, additionalFields = {}) {
  return {
    success: false,
    status: `Error: ${message}`,
    ...additionalFields,
  };
}

function createSuccessResponse(additionalFields = {}) {
  return {
    success: true,
    status: "Success",
    ...additionalFields,
  };
}

function logError(context, error) {
  log.error(`[${context}] Status: ${error.response?.status} - ${error.message}`);
}

function parseDuration(duration) {
  if (!duration) return null;

  try {
    const split = duration.match(/\d+|\D+/g);
    let time = parseInt(split[0]);
    const type = split[1]?.toLowerCase() || "d";

    if (type === "y") {
      time *= 365 * 24 * 60 * 60;
    } else if (type === "m") {
      time *= 30 * 24 * 60 * 60;
    } else if (type === "d") {
      time *= 24 * 60 * 60;
    } else if (type === "h") {
      time *= 60 * 60;
    } else {
      throw new Error(`Unrecognised duration unit "${split[1]}". Use d (days), m (months), y (years), or h (hours).`);
    }

    return time;
  } catch (e) {
    return null;
  }
}

exports.parseDuration = parseDuration;

exports.GetUniverseName = async function (universeId) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    
    // Use the games API directly with the universe ID
    const detailsUrl = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
    const detailsResponse = await axios.get(detailsUrl);
    
    if (detailsResponse.data && detailsResponse.data.data && detailsResponse.data.data[0]) {
      const gameData = detailsResponse.data.data[0];
      const name = gameData.name || "Unknown Universe";
      const rootPlaceId = gameData.rootPlaceId || "unknown";
      const displayName = `[${name} (${rootPlaceId})](https://www.roblox.com/games/${rootPlaceId})`;
      
      // Get icon from cache or CDN
      let icon = apiCache.getUniverseIcon(universeId);
      if (!icon) {
        try {
          const iconUrl = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${gameData.id}&size=512x512&format=Png&isCircular=false`;
          const iconResponse = await axios.get(iconUrl);

          if (iconResponse.data && iconResponse.data.data && iconResponse.data.data[0]) {
            icon = iconResponse.data.data[0].imageUrl || null;
            if (icon) apiCache.setUniverseIcon(universeId, icon);
          }
        } catch (iconError) {
          log.debug("Failed to fetch icon:", iconError.message);
        }
      }
      
      return {
        success: true,
        name: displayName,
        icon: icon,
        status: "Successfully retrieved universe name"
      };
    }

    // Fallback: return the ID if we can't fetch the name
    return {
      success: false,
      name: `Universe ${universeId}`,
      icon: null,
      status: "Could not fetch universe name, using ID"
    };
  } catch (error) {
    // Fallback: return the ID if there's an error
    return {
      success: false,
      name: `Universe ${universeId}`,
      icon: null,
      status: `Error: ${error.message}`
    };
  }
};

exports.setApiKey = apiCache.setApiKey;
exports.getApiKey = apiCache.getApiKey;
exports.hasApiKey = apiCache.hasApiKey;
exports.clearApiKey = apiCache.clearApiKey;
exports.getCachedUniverseIds = apiCache.getCachedUniverseIds;
exports.setUniverseName = apiCache.setUniverseName;
exports.getCachedUniverses = apiCache.getCachedUniverses;

