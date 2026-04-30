const { EmbedBuilder, MessageFlags } = require("discord.js");
const apiCache = require("../utils/apiCache");
const keystore = require("../utils/keystore");
const { formatDuration } = require("../utils/timeFormat");

const { version } = require("../../package.json");

module.exports = {
  category: "Info",
  description: "Show bot version, status, and data practices",
  slash: "both",
  permissions: ["ADMINISTRATOR"],
  ephemeral: true,

  callback: async ({ interaction, client }) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const consentStatus = guild && apiCache.hasConsent(guild.id);
    const storageMode = keystore.isEnabled() ? "Encrypted at rest" : "Memory-only (session)";
    const uptime = formatUptime(client.uptime);
    const app = await client.application.fetch();

    const embed = new EmbedBuilder()
      .setTitle(app.name || "Bot")
      .setDescription(app.description || "No description set.")
      .setColor(0x5865f2)
      .addFields(
        { name: "Version", value: version, inline: true },
        { name: "Uptime", value: uptime, inline: true },
        { name: "Guilds", value: String(client.guilds.cache.size), inline: true },
        { name: "Credential Storage", value: storageMode, inline: true },
        { name: "NLP Consent", value: consentStatus ? "Accepted" : "Not accepted", inline: true },
        {
          name: "Data Practices",
          value:
            "\u2022 API keys are encrypted with AES-256-GCM when `ENCRYPTION_KEY` is set\n" +
            "\u2022 NLP commands send your message text to Anthropic (Claude) for parsing\n" +
            "\u2022 Your Discord user ID is attached to ban actions as an audit trail on Roblox\n" +
            "\u2022 Command history is held in memory only and cleared on restart\n" +
            "\u2022 Use `/forgetme` to delete all stored data at any time",
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  if (!ms) return "Unknown";
  return formatDuration(ms);
}
