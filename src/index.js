require('dotenv').config();

//Polyfill for undici compatibility
const { ReadableStream } = require("node:stream/web");
globalThis.ReadableStream = ReadableStream;

//Modules
const discord = require("discord.js");
const wokcommands = require("wokcommands");
const path = require("path");

const discordToken = process.env.DISCORD_TOKEN;
const statusChannelId = process.env.STATUS_CHANNEL_ID;

if (!discordToken) {
    console.error("❌ Discord Token is undefined! Check your .env file or GitHub Secrets.");
}

const client = new discord.Client({
  intents: [discord.IntentsBitField.Flags.Guilds, discord.IntentsBitField.Flags.GuildMessages],
  allowedMentions: { parse: ["users"] },
});

client.on("clientReady", async () => {
  try {
    // Clear all global commands
    await client.application?.commands.set([]);
    console.log("Cleared all global commands");
    
    // Now load new commands
    new wokcommands(client, {
      commandsDir: path.join(__dirname, "commands"),
      // featuresDir: path.join(__dirname, "features"),
      mongoUri: "",
    });

    console.log("Bot is ready!");

    // Send online notification if STATUS_CHANNEL_ID is configured
    if (statusChannelId) {
      try {
        const channel = await client.channels.fetch(statusChannelId);
        if (channel && channel.isTextBased()) {
          const embed = new discord.EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 Bot is Online')
            .setDescription('Bot has come back online')
            .setTimestamp();
          
          await channel.send({ embeds: [embed] });
          console.log("Sent online notification");
        }
      } catch (error) {
        console.error("Failed to send online notification:", error);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
});

// Handle bot disconnect/offline
client.on("disconnect", () => {
  console.log("Bot disconnected");
});

// Handle bot closing (graceful shutdown)
process.on("SIGINT", async () => {
  console.log("Shutting down bot...");
  
  if (statusChannelId) {
    try {
      const channel = await client.channels.fetch(statusChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new discord.EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔴 Bot is Offline')
          .setDescription('Bot has gone offline')
          .setTimestamp();
        
        await channel.send({ embeds: [embed] });
        console.log("Sent offline notification");
      }
    } catch (error) {
      console.error("Failed to send offline notification:", error);
    }
  }
  
  client.destroy();
  process.exit(0);
});

client.login(discordToken);
