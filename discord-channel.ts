#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js'

// --- Configuration ---

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN
if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is required in environment')
}

const ALLOWED_IDS = new Set(
  (process.env.ALLOWED_DISCORD_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
if (ALLOWED_IDS.size === 0) {
  throw new Error(
    'ALLOWED_DISCORD_USER_IDS is required (comma-separated Discord user IDs)',
  )
}

// --- Discord Client ---

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
})

// Track last channel per allowed user for permission relay routing
const lastChannelByUser = new Map<string, string>()

// --- MCP Server ---

const mcp = new Server(
  { name: 'discord', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'Messages from Discord arrive as <channel source="discord" chat_id="..." sender_name="..." channel_name="...">. ' +
      'Reply with the discord_reply tool, passing the chat_id from the tag. ' +
      'The chat_id is a Discord channel ID where the message was sent.',
  },
)

// --- Reply Tool ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'discord_reply',
      description: 'Send a message back to a Discord channel',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: {
            type: 'string',
            description: 'The Discord channel ID to reply in',
          },
          text: {
            type: 'string',
            description: 'The message to send',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'discord_reply') {
    const { chat_id, text } = req.params.arguments as {
      chat_id: string
      text: string
    }

    try {
      const channel = await client.channels.fetch(chat_id)
      if (!channel || !channel.isSendable()) {
        return {
          content: [
            { type: 'text' as const, text: `Cannot send to channel ${chat_id}` },
          ],
        }
      }

      // Split into 2000-char chunks (Discord limit)
      for (let i = 0; i < text.length; i += 2000) {
        await channel.send(text.slice(i, i + 2000))
      }

      return { content: [{ type: 'text' as const, text: 'sent' }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Failed to send: ${msg}` }],
      }
    }
  }

  throw new Error(`unknown tool: ${req.params.name}`)
})

// --- Permission Relay Handler ---

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const embed = new EmbedBuilder()
    .setTitle('🔐 Permission Request')
    .addFields(
      { name: 'Tool', value: `\`${params.tool_name}\``, inline: true },
      { name: 'Description', value: params.description },
      {
        name: 'Input',
        value: `\`\`\`\n${params.input_preview.slice(0, 1000)}\n\`\`\``,
      },
    )
    .setColor(0xf59e0b)
    .setTimestamp()

  const allowBtn = new ButtonBuilder()
    .setCustomId(`perm_allow_${params.request_id}`)
    .setLabel('Allow')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅')

  const alwaysBtn = new ButtonBuilder()
    .setCustomId(`perm_always_${params.request_id}_${params.tool_name}`)
    .setLabel("Allow, don't ask again")
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔓')

  const denyBtn = new ButtonBuilder()
    .setCustomId(`perm_deny_${params.request_id}`)
    .setLabel('Deny')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌')

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(allowBtn, alwaysBtn, denyBtn)

  // Send to all tracked channels for allowed users
  for (const channelId of lastChannelByUser.values()) {
    try {
      const channel = await client.channels.fetch(channelId)
      if (channel?.isSendable()) {
        await channel.send({ embeds: [embed], components: [row] })
      }
    } catch {
      // Channel may no longer be accessible, skip
    }
  }
})

// --- Connect MCP first, then Discord ---

await mcp.connect(new StdioServerTransport())
await client.login(DISCORD_TOKEN)

// --- Discord Events ---

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

client.on(Events.ClientReady, () => {
  console.error(`Discord channel connected as ${client.user?.tag}`)
})

client.on(Events.MessageCreate, async (message) => {
  // Ignore bot's own messages
  if (message.author.id === client.user?.id) return

  // Sender gating
  if (!ALLOWED_IDS.has(message.author.id)) return

  // Track channel for permission relay routing
  lastChannelByUser.set(message.author.id, message.channelId)

  // Check for permission verdict
  const m = PERMISSION_REPLY_RE.exec(message.content)
  if (m) {
    await mcp.notification({
      method: 'notifications/claude/channel/permission' as any,
      params: {
        request_id: m[2].toLowerCase(),
        behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
      },
    })
    return
  }

  // Forward as channel event
  const channelName = 'name' in message.channel ? message.channel.name : 'DM'
  await mcp.notification({
    method: 'notifications/claude/channel' as any,
    params: {
      content: message.content,
      meta: {
        chat_id: message.channelId,
        sender_name: message.author.username,
        channel_name: channelName ?? 'unknown',
      },
    },
  })
})

// --- Button Interaction Handler ---

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return

  // Sender gating
  if (!ALLOWED_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: 'Not authorized.', flags: 64 })
    return
  }

  // Match allow/deny buttons
  const singleMatch = interaction.customId.match(/^perm_(allow|deny)_([a-km-z]{5})$/)
  // Match "always allow" button: perm_always_{requestId}_{toolName}
  const alwaysMatch = interaction.customId.match(/^perm_always_([a-km-z]{5})_(.+)$/)

  if (!singleMatch && !alwaysMatch) return

  const requestId = singleMatch ? singleMatch[2] : alwaysMatch![1]
  const behavior = singleMatch?.[1] === 'deny' ? 'deny' : 'allow'

  // Send permission verdict to Claude Code
  await mcp.notification({
    method: 'notifications/claude/channel/permission' as any,
    params: {
      request_id: requestId,
      behavior,
    },
  })

  // If "always allow", add tool to .claude/settings.json
  if (alwaysMatch) {
    const toolName = alwaysMatch[2]
    const mcpToolName = `mcp__discord__${toolName}`
    const settingsPath = join(process.cwd(), '.claude', 'settings.json')

    try {
      let settings: { permissions?: { allow?: string[] } } = {}
      try {
        settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
      } catch {
        // File doesn't exist yet
      }

      settings.permissions ??= {}
      settings.permissions.allow ??= []

      if (!settings.permissions.allow.includes(mcpToolName)) {
        settings.permissions.allow.push(mcpToolName)
        await mkdir(join(process.cwd(), '.claude'), { recursive: true })
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      }
    } catch {
      // Best effort — settings write failed, permission still granted for this request
    }
  }

  // Update the message to show the decision
  let label: string
  let style: ButtonStyle
  if (behavior === 'deny') {
    label = '❌ Denied'
    style = ButtonStyle.Danger
  } else if (alwaysMatch) {
    label = '🔓 Always Allowed'
    style = ButtonStyle.Primary
  } else {
    label = '✅ Allowed'
    style = ButtonStyle.Success
  }

  await interaction.update({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`perm_resolved_${requestId}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(true),
      ),
    ],
  })
})

// --- Graceful Shutdown ---

process.on('SIGINT', () => {
  client.destroy()
  process.exit(0)
})
process.on('SIGTERM', () => {
  client.destroy()
  process.exit(0)
})
