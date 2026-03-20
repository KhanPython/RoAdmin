const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("../openCloudAPI");
const { pushHistory } = require("../utils/commandHistory");
const { buildRemoveFromBoardEmbed, buildInternalErrorEmbed, buildResultEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "Removes leaderboard entry for a user",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  minArgs: 3,
  expectedArgs: "<userId> <leaderboardName> <universeId> [key]",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The user ID to remove from leaderboard",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "leaderboard",
      description: "The leaderboard name",
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
      name: "key",
      description: "The specific key to remove (optional, defaults to {userId})",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const leaderboardName = interaction?.options?.getString("leaderboard") || args[1];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[2]);
    const key = interaction?.options?.getString("key") || args[3] || null;

    const check = await validateCommand(interaction, {
      userId, universeId, leaderboardName, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {
      // Attempt deletion directly - the Roblox API returns 404 if the key doesn't exist,
      // so there's no need to paginate the full leaderboard just to confirm existence first.
      const response = await openCloud.RemoveOrderedDataStoreData(interaction.guildId, userId, leaderboardName, key, "global", universeId);

      if (!response.success && response.status && response.status.toLowerCase().includes("not found")) {
        const keyToCheck = key || `${userId}`;
        const notFoundEmbed = buildResultEmbed(
          "Remove Leaderboard Entry",
          { success: false, status: `Key \`${keyToCheck}\` not found` },
          [
            { name: "User ID:", value: `\`${userId}\``, inline: true },
            { name: "Universe ID:", value: `\`${universeId}\``, inline: true },
            { name: "Leaderboard Name:", value: leaderboardName, inline: true },
            { name: "Key searched:", value: keyToCheck, inline: true },
          ],
          undefined,
          universeInfo.icon ?? null,
          universeInfo.name ? `**Experience:** ${universeInfo.name}\n\n⚠️ Key \`${keyToCheck}\` was not found in leaderboard **${leaderboardName}**.` : `⚠️ Key \`${keyToCheck}\` was not found in leaderboard **${leaderboardName}**.`,
        ).setColor(0xFFFF00);

        await interaction.editReply({ embeds: [notFoundEmbed] });
        return;
      }

      if (response.success) {
        pushHistory(interaction.channelId, interaction.user.id, "removeFromBoard", { userId, leaderboardName, key, universeId });
      }

      await interaction.editReply({ embeds: [buildRemoveFromBoardEmbed(response, { userId, universeId, leaderboardName, key }, universeInfo)] });
    } catch (error) {
      log.error("Error in removeFromBoard command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] });
    }
  },
};
