// Universe ID validation helpers

async function verifyUniverseExists(openCloud, universeId) {
  try {
    const universeInfo = await openCloud.GetUniverseName(universeId);
    
    if (!universeInfo.success) {
      return {
        success: false,
        universeInfo: null,
        errorMessage: `❌ Universe ${universeId} does not exist or could not be found.`
      };
    }
    
    return {
      success: true,
      universeInfo: universeInfo,
      errorMessage: null
    };
  } catch (error) {
    return {
      success: false,
      universeInfo: null,
      errorMessage: `❌ Error verifying universe: ${error.message}`
    };
  }
}

module.exports = {
  verifyUniverseExists,
};
