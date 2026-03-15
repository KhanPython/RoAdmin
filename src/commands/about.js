const { EmbedBuilder, MessageFlags } = require("discord.js");
const apiCache = require("../utils/apiCache");
const keystore = require("../utils/keystore");

module.exports = {
  category: "Info",
  description: "Show bot version, status, and data practices",
  slash: "both",

  callback: async ({ interaction, client }) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const universeCount = apiCache.getCachedUniverseIds().length;
    const consentStatus = guild && apiCache.hasConsent(guild.id);
    const storageMode = keystore.isEnabled() ? "Encrypted at rest" : "Memory-only (session)";
    const uptime = formatUptime(client.uptime);

    const embed = new EmbedBuilder()
      .setTitle("RoAdmin")
      .setDescription("Roblox administration via Discord slash commands and natural language.")
      .setColor(0x5865f2)
      .addFields(
        { name: "Version", value: "1.0.0", inline: true },
        { name: "Uptime", value: uptime, inline: true },
        { name: "Guilds", value: String(client.guilds.cache.size), inline: true },
        { name: "Configured Universes", value: String(universeCount), inline: true },
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
      .setFooter({ text: "MIT License \u2022 github.com/KhanPython/RoAdmin" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  if (!ms) return "Unknown";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
