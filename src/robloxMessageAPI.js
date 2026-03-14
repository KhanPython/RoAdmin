const axios = require("axios").default;

// Returns a status string
exports.MessageSend = async function MessageSend(
  message,
  universeId,
  topic,
  apiKey
) {
  try {
    const response = await axios.post(
      `https://apis.roblox.com/messaging-service/v1/universes/${universeId}/topics/${topic}`,
      { message },
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 200) {
      return { status: "Success", success: true };
    }
    return { status: "An unknown issue has occurred", success: false };
  } catch (err) {
    const status = err.response?.status;
    switch (status) {
      case 401:
        return { status: "API key not valid for operation, user does not have authorization", success: false };
      case 403:
        return { status: "Publish is not allowed on this universe", success: false };
      case 400:
        if (err.response?.data?.includes?.("1024 characters"))
          return { status: "The request message cannot be longer than 1024 characters", success: false };
        return { status: "Invalid request", success: false };
      case 429:
        return { status: "Rate limited - Please wait a moment before trying again", success: false };
      case 500:
        return { status: "Roblox server error - Try again later", success: false };
      default:
        return {
          status: status ? `HTTP Error ${status}` : "Network error - Could not reach Roblox servers",
          success: false,
        };
    }
  }
};
