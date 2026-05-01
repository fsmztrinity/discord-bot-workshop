require("dotenv/config");
const { Client, IntentsBitField } = require("discord.js");
const parseAndReply = require("./parse-and-reply.js");
const chatWithGpt = require("./chat-with-gpt.js");

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// 🔒 prevents multiple simultaneous OpenAI calls (VERY important for free tier)
let busy = false;

// 🧠 safe wrapper (prevents 429 spikes)
async function safeChat(fn) {
  while (busy) {
    await new Promise((r) => setTimeout(r, 300));
  }

  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

client.on("ready", () => {
  console.log("The bot is online!");
});

const channelMemory = new Map(); // per-channel memory

function cleanMessage(text) {
  return text
    .replace(/<@!?\\d+>/g, "")   // user mentions
    .replace(/<@&\\d+>/g, "")    // role mentions
    .trim();
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase().startsWith("quiet")) return;

  const wasMentioned = message.mentions.has(client.user);

  const isReplyToBot = message.reference?.messageId
    ? await message.channel.messages
        .fetch(message.reference.messageId)
        .then((ref) => ref.author.id === client.user.id)
        .catch(() => false)
    : false;

  if (!wasMentioned && !isReplyToBot) return;

  // 🧹 CLEAN INPUT (IMPORTANT FIX)
  const userInput = cleanMessage(message.content);

  await message.channel.sendTyping();

  try {
    const conversationLog = [
      {
        role: "system",
        content: "You are a helpful assistant. Answer clearly and concisely."
      },
      {
        role: "user",
        content: userInput
      }
    ];

    const gptResponse = await chatWithGpt(conversationLog);

    if (!gptResponse) {
      return message.reply("OpenAI is busy right now. Try again.");
    }

    await parseAndReply(gptResponse, message);

  } catch (error) {
    console.error("Bot error:", error);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);