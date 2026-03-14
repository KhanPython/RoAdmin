const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");
const llmCache = require("../utils/llmCache");

module.exports = {
  category: "Config",
  description: "Set the Anthropic API key used for natural language command processing",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  guildOnly: true,

  options: [
    {
      name: "apikey",
      description: "Your Anthropic API key (sk-ant-...)",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ args, interaction }) => {
    const apiKey = interaction?.options?.getString("apikey") || args[0];

    if (!apiKey || apiKey.trim().length === 0) {
      await interaction.reply({
        content: "❌ Please provide a non-empty API key.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Validate by making a minimal API call
    try {
      const client = new Anthropic.default({ apiKey });
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      });
    } catch (err) {
      llmCache.setLlmKey(null);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Invalid API Key")
            .setColor(0xff0000)
            .setDescription(`The key could not be validated: ${err.message}`)
            .setTimestamp(),
        ],
      });
      return;
    }

    llmCache.setLlmKey(apiKey);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ LLM API Key Configured")
          .setColor(0x00ff00)
          .setDescription(
            "Anthropic API key stored for this session.\n\n" +
            "Mention the bot in any channel to issue commands in plain English.\n" +
            "Example: `@RoAdmin ban user 12345 for cheating in MyGame`"
          )
          .addFields({
            name: "Note",
            value: "This key is stored in memory only and will be lost when the bot restarts.",
          })
          .setTimestamp(),
      ],
    });
  },
};
