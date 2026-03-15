const axios = require("axios").default;

const REQUEST_TIMEOUT = 10000;

exports.UserInfoById = async function UserInfoById(userId) {
  try {
    const response = await axios.get(`https://users.roblox.com/v1/users/${userId}/`, {
      timeout: REQUEST_TIMEOUT,
    });
    return { status: "Success", success: true, data: response };
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
