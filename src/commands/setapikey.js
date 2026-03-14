const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("./../openCloudAPI");

module.exports = {
  category: "Config",
  description: "Set the Roblox API key for a specific universe",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  minArgs: 2,
  expectedArgs: "<universeId> <apiKey>",
  guildOnly: true,

  options: [
    {
      name: "universeid",
      description: "The Roblox universe ID",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "apikey",
      description: "The Roblox Open Cloud API key",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[0]);
    const apiKey = interaction?.options?.getString("apikey") || args[1];

    // Validate universeId
    if (!universeId || isNaN(universeId)) {
      await interaction.reply({
        content: "❌ Invalid Universe ID. Please provide a valid number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate API key (basic check - should be a string with some content)
    if (!apiKey || apiKey.trim().length === 0) {
      await interaction.reply({
        content: "❌ Invalid API key. Please provide a non-empty key.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // Store the API key in cache FIRST
      openCloud.setApiKey(universeId, apiKey);

      // Then try to verify by fetching universe info (public API - doesn't validate the API key)
      let universeInfo;
      try {
        universeInfo = await openCloud.GetUniverseName(universeId);
        // Cache the universe name so NLP can resolve game names to IDs
        openCloud.setUniverseName(universeId, universeInfo.name);
      } catch (verifyError) {
        // API key is stored, but verification of universe info failed
        console.error("Universe verification failed:", verifyError.message);
        universeInfo = { name: `Universe ${universeId}`, icon: null };
      }

      // Validate the API key by trying to access a Cloud API endpoint (doesn't require a specific datastore to exist)
      try {
        const axios = require("axios");
        const testUrl = `https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/dummy/scopes/global/entries/test`;
        const response = await axios.get(testUrl, {
          headers: {
            "x-api-key": apiKey,
          },
          validateStatus: function (status) {
            // Accept any status that isn't an auth error
            return status !== 401 && status !== 403;
          },
        });
      } catch (apiKeyError) {
        // Clear the key if there was an auth error
        openCloud.clearApiKey(universeId);
        throw new Error("API key is invalid or unauthorized for this universe");
      }

      const embed = new EmbedBuilder()
        .setTitle("API Key Configured")
        .setColor(0x00FF00)
        .setDescription(`API key for universe ${universeId} has been cached in the bot's memory.`)
        .addFields(
          { name: "Universe ID:", value: universeId.toString() },
          { name: "Experience:", value: universeInfo.name || "Unknown" }
        )
        .setFooter({
          text: "This API key is stored in memory and will be lost when the bot restarts.",
        })
        .setTimestamp();

      if (universeInfo.icon) {
        embed.setThumbnail(universeInfo.icon);
      }

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
