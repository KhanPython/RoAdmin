const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("./../openCloudAPI");
const { pushHistory } = require("../utils/commandHistory");
const { buildBanEmbed, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "Bans the player from the experience by UserId",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
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

    if (reason && reason.length > 500) {
      return "Ban reason cannot exceed 500 characters.";
    }

    const check = await validateCommand(interaction, {
      userId, universeId, duration, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      const response = await openCloud.BanUser(interaction.guildId, userId, reason, duration, excludeAltAccounts, universeId, interaction.user.id);

      if (response.success) {
        pushHistory(interaction.channelId, interaction.user.id, "ban", { userId, reason, duration, excludeAltAccounts, universeId });
      }

      await interaction.editReply({ embeds: [buildBanEmbed(response, { userId, universeId, reason, duration, excludeAltAccounts }, universeInfo)] });
    } catch (error) {
      log.error("Error in ban command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] });
    }
  },
};
