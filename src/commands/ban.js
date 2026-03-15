const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("./../openCloudAPI");
const apiCache = require("./../utils/apiCache");
const universeUtils = require("./../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildBanEmbed, buildErrorEmbed } = require("../utils/formatters");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "Bans the player from the experience by UserId",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 3,
  expectedArgs: "<userId> <reason> <universeId> [duration] [excludealts]",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The user identification",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "reason",
      description: "Reason for the ban",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "duration",
      description: "The duration to ban the user (optional - e.g., '7d', '2m', '1y' for days, months, years)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "excludealts",
      description: "Ban alternate accounts too (default: false)",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const reason = interaction?.options?.getString("reason") || args[1];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[2]);
    const duration = interaction?.options?.getString("duration") || args[3] || null;
    const excludeAltAccounts = interaction?.options?.getBoolean("excludealts") || false;

    if (!userId || isNaN(userId)) {
      return "Please provide a valid user ID.";
    }

    if (!universeId || isNaN(universeId)) {
      return "Please provide a valid Universe ID.";
    }

    if (duration) {
      const split = duration.match(/\d+|\D+/g);
      if (!split || split.length !== 2) {
        return 'Invalid time format! Example format: "7d" where "d" = days, "m" = months, "y" = years.';
      }
      const type = split[1].toLowerCase();
      if (!["d", "m", "y", "h"].includes(type)) {
        return 'Please use "d" (days), "m" (months), "y" (years), or "h" (hours) for duration';
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!openCloud.hasApiKey(universeId)) {
        await interaction.editReply({ embeds: [apiCache.createMissingApiKeyEmbed(universeId)] });
        return;
      }

      const universeCheck = await universeUtils.verifyUniverseExists(openCloud, universeId);
      if (!universeCheck.success) {
        await interaction.editReply({ content: universeCheck.errorMessage });
        return;
      }
      const universeInfo = universeCheck.universeInfo;

      const response = await openCloud.BanUser(userId, reason, duration, excludeAltAccounts, universeId, interaction.user.id);

      if (response.success) {
        pushHistory(interaction.channelId, interaction.user.id, "ban", { userId, reason, duration, excludeAltAccounts, universeId });
      }

      await interaction.editReply({ embeds: [buildBanEmbed(response, { userId, universeId, reason, duration, excludeAltAccounts }, universeInfo)] });
    } catch (error) {
      log.error("Error in ban command:", error.message);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
