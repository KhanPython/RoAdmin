const axios = require("axios").default;
const { OpenCloud, DataStoreService } = require("rbxcloud");
const apiCache = require("./utils/apiCache");

// ============================================
// DATA STORE OPERATIONS
// ============================================

/**
 * Get a value from a datastore using a specific key
 * @param {string} key - The datastore entry key
 * @param {number} universeId - The Roblox universe ID (required)
 * @param {string} datastoreName - Name of the datastore
 * @returns {Promise<{success: boolean, data: any, status: string}>}
 */
exports.GetDataStoreEntry = async function (key, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
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

    // Use REST API directly
    const path = `universes/${universeId}/data-stores/${datastoreName}/scopes/global/entries`;
    const url = new URL(`https://apis.roblox.com/cloud/v2/${path}`);
    url.searchParams.append('entryKey', key);

    const response = await axios.get(url.toString(), {
      headers: getApiHeaders(universeId),
    });

    if (response.status === 200) {
      const data = response.data;
      return createSuccessResponse({ data });
    }
    return createDataStoreErrorResponse("GetDataStoreEntry", `Unexpected status: ${response.status}`, { data: null });
  } catch (error) {
    console.error(`Error getting data for key ${key}:`, error.message);
    // Return empty data rather than erroring out, in case entry doesn't exist
    if (error.response?.status === 404) {
      return createSuccessResponse({ data: null });
    }
    return createDataStoreErrorResponse("GetDataStoreEntry", error.message, { data: null });
  }
};

/**
 * Get a value from the player currency datastore
 * @param {number} userId - The Roblox user ID
 * @param {number} universeId - The Roblox universe ID (required)
 * @param {string} datastoreName - Name of the datastore (default: "player_currency")
 * @returns {Promise<{success: boolean, data: any, status: string}>}
 */
exports.GetPlayerData = async function (userId, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
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
    console.error(`Error getting data for user ${userId}:`, error.message);
    // Return empty data rather than erroring out, in case entry doesn't exist
    if (error.response?.status === 404) {
      return createSuccessResponse({ data: null });
    }
    return createDataStoreErrorResponse("GetPlayerData", error.message, { data: null });
  }
};

/**
 * Set a value in the player currency datastore
 * @param {number} userId - The Roblox user ID
 * @param {any} value - The data to store
 * @param {number} universeId - The Roblox universe ID (required)
 * @param {string} datastoreName - Name of the datastore
 * @returns {Promise<{success: boolean, status: string}>}
 */
exports.SetPlayerData = async function (userId, value, universeId, datastoreName) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
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
    console.error(`Error setting data for user ${userId}:`, error.message);
    return createDataStoreErrorResponse("SetPlayerData", error.message);
  }
};

/**
 * Increment a value in the datastore
 * @param {number} userId - The Roblox user ID
 * @param {number} amount - The amount to increment by
 * @param {string} datastoreName - Name of the datastore
 * @returns {Promise<{success: boolean, newValue: number, status: string}>}
 */
exports.IncrementPlayerData = async function (userId, amount, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const [newValue, keyInfo] = await datastore.IncrementAsync(`player_${userId}`, amount);
    return createSuccessResponse({ newValue });
  } catch (error) {
    console.error(`Error incrementing data for user ${userId}:`, error);
    return createDataStoreErrorResponse("IncrementPlayerData", error.message, { newValue: null });
  }
};

/**
 * Update a value in the datastore using an update function
 * @param {number} userId - The Roblox user ID
 * @param {Function} updateFunction - Function that takes (data, keyInfo) and returns new data
 * @param {string} datastoreName - Name of the datastore
 * @returns {Promise<{success: boolean, newValue: any, status: string}>}
 */
exports.UpdatePlayerData = async function (userId, updateFunction, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const newValue = await datastore.UpdateAsync(`player_${userId}`, updateFunction);
    return createSuccessResponse({ newValue });
  } catch (error) {
    console.error(`Error updating data for user ${userId}:`, error);
    return createDataStoreErrorResponse("UpdatePlayerData", error.message, { newValue: null });
  }
};

/**
 * Delete a value from the datastore
 * @param {number} userId - The Roblox user ID
 * @param {string} datastoreName - Name of the datastore
 * @returns {Promise<{success: boolean, oldValue: any, status: string}>}
 */
exports.RemovePlayerData = async function (userId, datastoreName) {
  try {
    const datastore = DataStoreService.GetDataStore(datastoreName);
    const oldValue = await datastore.RemoveAsync(`player_${userId}`);
    return createSuccessResponse({ oldValue });
  } catch (error) {
    console.error(`Error removing data for user ${userId}:`, error);
    return createDataStoreErrorResponse("RemovePlayerData", error.message, { oldValue: null });
  }
};

/**
 * Remove data from an ordered datastore for a user
 * @param {number} userId - The Roblox user ID
 * @param {string} orderedDatastoreName - Name of the ordered datastore
 * @param {string} key - The key to remove (optional, defaults to {userId})
 * @returns {Promise<{success: boolean, status: string}>}
 */
exports.ListOrderedDataStoreEntries = async function (orderedDatastoreName, scopeId = "global", pageToken = null, universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
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
    
    // Check different possible response structures
    const entries = response.data.orderedDataStoreEntries || response.data.dataStoreEntries || response.data.entries || [];
    const nextPageToken = response.data.nextPageToken || null;
    
    return createSuccessResponse({ entries: Array.isArray(entries) ? entries : [], nextPageToken });
  } catch (error) {
    console.error(`Error listing ordered datastore entries:`, error);
    console.error(`[DEBUG] Error response data:`, error.response?.data);
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
    const apiKey = apiCache.getApiKey(universeId);
    if (!apiKey) {
      throw new Error(`API key not found in cache for universe ${universeId}`);
    }
    const keyToRemove = key ? String(key) : String(userId);
    
    // Use POST to set value to 0 instead of DELETE (DELETE not supported for ordered datastores)
    const path = `universes/${universeId}/ordered-data-stores/${orderedDatastoreName}/scopes/${scopeId}/entries`;
    const url = new URL(`https://apis.roblox.com/cloud/v2/${path}`);
    url.searchParams.append('id', keyToRemove);
    
    const payload = { value: 0 };
    
    const response = await axios.post(url.toString(), payload, {
      headers: getApiHeaders(universeId),
    });
    
    if (response.status === 200) {
      return createSuccessResponse({ message: `Removed entry "${keyToRemove}" from ordered datastore "${orderedDatastoreName}"` });
    }
    
    return createDataStoreErrorResponse("RemoveOrderedDataStoreData", `Unexpected response status: ${response.status}`);
  } catch (error) {
    console.error(`Error removing ordered datastore data for user ${userId}:`, error.message);
    console.error(`[DEBUG] Error status: ${error.response?.status}`);
    console.error(`[DEBUG] Error response data:`, error.response?.data);
    
    if (error.response?.status === 404) {
      return createDataStoreErrorResponse("RemoveOrderedDataStoreData", "Key not found in ordered datastore");
    }
    const status = error.response?.status;
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("RemoveOrderedDataStoreData", errorMsg);
  }
};

/**
 * Check if a key exists in an ordered datastore (across all pages)
 * @param {string} keyToFind - The key/userId to search for
 * @param {string} orderedDatastoreName - Name of the ordered datastore
 * @param {string} scopeId - Scope ID (default: "global")
 * @returns {Promise<{exists: boolean, entry: Object|null, message: string}>}
 */
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
    console.error(`Error checking ordered datastore key:`, error);
    return { exists: false, entry: null, message: `Error: ${error.message}` };
  }
};

// ============================================
// USER RESTRICTIONS API (BAN MANAGEMENT)
// ============================================


/**
 * Ban a user using Roblox Open Cloud User Restrictions API (PATCH)
 * @param {number} userId - The Roblox user ID
 * @param {string} reason - Reason for the ban
 * @param {string} duration - Duration (e.g., "10d", "2h", "30m") or null for permanent
 * @param {boolean} excludeAltAccounts - Whether to ban alternate accounts (default: false)
 * @returns {Promise<{success: boolean, status: string, expiresDate: Date|null}>}
 */
exports.BanUser = async function (userId, reason, duration, excludeAltAccounts = false, universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
    let durationSeconds = null;
    let expiresDate = null;
    let durationString = null;

    if (duration) {
      durationSeconds = parseDuration(duration);
      expiresDate = new Date(Date.now() + durationSeconds * 1000);
      durationString = `${durationSeconds}s`;
    }

    const payload = {
      gameJoinRestriction: {
        active: true,
        privateReason: reason,
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
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("BanUser", errorMsg, { expiresDate: null });
  }
};

/**
 * Unban a user using Roblox Open Cloud User Restrictions API
 * @param {number} userId - The Roblox user ID
 * @returns {Promise<{success: boolean, status: string}>}
 */
exports.UnbanUser = async function (userId, universeId = null) {
  try {
    if (!universeId) {
      throw new Error("Universe ID is required");
    }
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
    
    const errorMsg = getHttpErrorMessage(status) || error.message;
    return createDataStoreErrorResponse("UnbanUser", errorMsg);
  }
};


// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get API headers with authentication
 * @param {number} universeId - The Roblox universe ID (required to get correct API key)
 * @returns {Object} Headers object with API key
 */
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

/**
 * Get HTTP error message from status code
 * @param {number} status - HTTP status code
 * @returns {string} Error message
 */
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
    default:
      return `HTTP Error ${status}`;
  }
}

/**
 * Create a generic datastore error response
 * @param {string} operation - The operation being performed
 * @param {string} message - Error message
 * @param {Object} additionalFields - Additional fields to include
 * @returns {Object} Error response object
 */
function createDataStoreErrorResponse(operation, message, additionalFields = {}) {
  return {
    success: false,
    status: `Error: ${message}`,
    ...additionalFields,
  };
}

/**
 * Create a generic success response
 * @param {Object} additionalFields - Additional fields to include
 * @returns {Object} Success response object
 */
function createSuccessResponse(additionalFields = {}) {
  return {
    success: true,
    status: "**Success**",
    ...additionalFields,
  };
}

/**
 * Log an error with context
 * @param {string} context - Context label
 * @param {Object} error - Error object
 */
function logError(context, error) {
  console.error(`[${context}] Status: ${error.response?.status}`);
  console.error(`[${context}] Data:`, error.response?.data);
  console.error(`[${context}] Message:`, error.message);
}

/**
 * Parse duration string to seconds
 * @param {string} duration - Duration string (e.g., "7d", "2m", "1y" for days, months, years)
 * @returns {number} Duration in seconds, or null if invalid
 */
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
    } else {
      return null;
    }

    return time;
  } catch (e) {
    return null;
  }
}

exports.parseDuration = parseDuration;

// ============================================
// UNIVERSE/EXPERIENCE INFORMATION
// ============================================

/**
 * Get the experience name and icon from a universe ID
 * @param {number} universeId - The Roblox universe ID
 * @returns {Promise<{success: boolean, name: string, icon: string|null, status: string}>}
 */
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
      
      // Get icon from CDN using the universe ID
      let icon = null;
      try {
        const iconUrl = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${gameData.id}&size=512x512&format=Png&isCircular=false`;
        const iconResponse = await axios.get(iconUrl);
        
        if (iconResponse.data && iconResponse.data.data && iconResponse.data.data[0]) {
          icon = iconResponse.data.data[0].imageUrl || null;
        }
      } catch (iconError) {
        console.error(`[DEBUG] Failed to fetch icon:`, iconError.message);
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

// ============================================
// API CACHE MANAGEMENT
// ============================================

// Export cache management functions
exports.setApiKey = apiCache.setApiKey;
exports.getApiKey = apiCache.getApiKey;
exports.hasApiKey = apiCache.hasApiKey;
exports.clearApiKey = apiCache.clearApiKey;
exports.getCachedUniverseIds = apiCache.getCachedUniverseIds;

