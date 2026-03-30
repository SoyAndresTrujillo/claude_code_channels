# Claude Code Channels Reference

> Source: https://code.claude.com/docs/en/channels-reference
> Retrieved: 2026-03-24

> Build an MCP server that pushes webhooks, alerts, and chat messages into a Claude Code session. Reference for the channel contract: capability declaration, notification events, reply tools, sender gating, and permission relay.

Channels are in **research preview** and require **Claude Code v2.1.80+**. They require claude.ai login. Console and API key authentication is not supported. Team and Enterprise organizations must explicitly enable them.

### Page Contents

- Overview: how channels work
- What you need: requirements and general steps
- Example: build a webhook receiver: a minimal one-way walkthrough
- Server options: the constructor fields
- Notification format: the event payload
- Expose a reply tool: let Claude send messages back
- Gate inbound messages: sender checks to prevent prompt injection
- Relay permission prompts: forward tool approval prompts to remote channels

To use an existing channel instead of building one, see Channels (`/en/channels`). Telegram, Discord, iMessage, and fakechat are included in the research preview.

---

## Overview

A **channel** is an [MCP](https://modelcontextprotocol.io) server that runs on the same machine as Claude Code. Claude Code spawns it as a subprocess and communicates over **stdio**. Your channel server is the bridge between external systems and the Claude Code session.

### Channel Types

- **One-way channels**: Forward alerts, webhooks, or monitoring events for Claude to act on.
- **Two-way channels**: Also expose a reply tool so Claude can send messages back. Can opt in to relay permission prompts for remote tool approval.

### How It Works

- **Chat platforms** (Telegram, Discord): Your plugin runs locally and polls the platform's API for new messages. When someone DMs your bot, the plugin receives the message and forwards it to Claude. No URL to expose.
- **Webhooks** (CI, monitoring): Your server listens on a local HTTP port. External systems POST to that port, and your server pushes the payload to Claude.

> **Architecture diagram**: External systems connect to your local channel server, which communicates with Claude Code over stdio. (SVG at `en/images/channel-architecture.svg`, 600x220)

---

## What You Need

The only hard requirement is the [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) package and a Node.js-compatible runtime. [Bun](https://bun.sh), [Node](https://nodejs.org), and [Deno](https://deno.com) all work. The pre-built plugins in the research preview use Bun, but your channel doesn't have to.

Your server needs to:

1. Declare the `claude/channel` capability so Claude Code registers a notification listener
2. Emit `notifications/claude/channel` events when something happens
3. Connect over stdio transport (Claude Code spawns your server as a subprocess)

During the research preview, custom channels aren't on the approved allowlist (`/en/channels#supported-channels`). Use `--dangerously-load-development-channels` to test locally. See "Test during the research preview" for details.

---

## Example: Build a Webhook Receiver

### Step 1: Create the project

```bash
mkdir webhook-channel && cd webhook-channel
bun add @modelcontextprotocol/sdk
```

### Step 2: Write the channel server

```ts
// webhook.ts
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Create the MCP server and declare it as a channel
const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    // this key is what makes it a channel
    capabilities: { experimental: { 'claude/channel': {} } },
    // added to Claude's system prompt
    instructions: 'Events from the webhook channel arrive as <channel source="webhook" ...>. They are one-way: read them and act, no reply expected.',
  },
)

// Connect to Claude Code over stdio
await mcp.connect(new StdioServerTransport())

// Start an HTTP server that forwards every POST to Claude
Bun.serve({
  port: 8788,
  hostname: '127.0.0.1', // localhost-only
  async fetch(req) {
    const body = await req.text()
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { path: new URL(req.url).pathname, method: req.method },
      },
    })
    return new Response('ok')
  },
})
```

**The file does three things:**
1. **Server configuration**: Creates MCP server with `claude/channel` capability. The `instructions` string goes into Claude's system prompt.
2. **Stdio connection**: Connects to Claude Code over stdin/stdout (standard MCP).
3. **HTTP listener**: Starts local web server on port 8788, forwards every POST body as a channel event.

### Step 3: Register with Claude Code

Add the server to your MCP config so Claude Code knows how to start it. For a **project-level** `.mcp.json` in the same directory, use a relative path. For **user-level** config in `~/.claude.json`, use the full absolute path so the server can be found from any project:

```json
{
  "mcpServers": {
    "webhook": { "command": "bun", "args": ["./webhook.ts"] }
  }
}
```

Claude Code reads your MCP config at startup and spawns each server as a subprocess.

### Step 4: Test it

```bash
# Start Claude Code with development flag
claude --dangerously-load-development-channels server:webhook

# In a separate terminal, simulate a webhook
curl -X POST localhost:8788 -d "build failed on main: https://ci.example.com/run/1234"
```

When Claude Code starts, it reads your MCP config, spawns your `webhook.ts` as a subprocess, and the HTTP listener starts automatically on the port you configured (8788 in this example). You don't need to run the server yourself.

If you see "blocked by org policy," your Team or Enterprise admin needs to enable channels (`/en/channels#enterprise-controls`) first.

The payload arrives as:
```
<channel source="webhook" path="/" method="POST">build failed on main: https://ci.example.com/run/1234</channel>
```

In your Claude Code terminal, you'll see Claude receive the message and start responding: reading files, running commands, or whatever the message calls for. This is a one-way channel, so Claude acts in your session but doesn't send anything back through the webhook.

**Troubleshooting:**
- **`curl` succeeds but nothing reaches Claude**: Run `/mcp` in your session to check the server's status. "Failed to connect" usually means a dependency or import error in your server file; check the debug log at `~/.claude/debug/<session-id>.txt` for the stderr trace.
- **`curl` fails with "connection refused"**: The port is either not bound yet or a stale process from an earlier run is holding it. `lsof -i :<port>` shows what's listening; `kill` the stale process before restarting your session.

The [fakechat server](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat) extends this pattern with a web UI, file attachments, and a reply tool for two-way chat.

---

## Test During Research Preview

```bash
# Testing a plugin you're developing
claude --dangerously-load-development-channels plugin:yourplugin@yourmarketplace

# Testing a bare .mcp.json server
claude --dangerously-load-development-channels server:webhook
```

The bypass is per-entry. Combining this flag with `--channels` doesn't extend the bypass to the `--channels` entries. During the research preview, the approved allowlist is Anthropic-curated, so your channel stays on the development flag while you build and test.

> **Note:** This flag skips the allowlist only. The `channelsEnabled` organization policy still applies. Don't use it to run channels from untrusted sources.

---

## Server Options

A channel sets these options in the [`Server`](https://modelcontextprotocol.io/docs/concepts/servers) constructor. The `instructions` and `capabilities.tools` fields are [standard MCP](https://modelcontextprotocol.io/docs/concepts/servers); `capabilities.experimental['claude/channel']` and `capabilities.experimental['claude/channel/permission']` are the channel-specific additions:

| Field | Type | Description |
|:------|:-----|:------------|
| `capabilities.experimental['claude/channel']` | `object` | **Required.** Always `{}`. Presence registers the notification listener. |
| `capabilities.experimental['claude/channel/permission']` | `object` | Optional. Always `{}`. Declares that this channel can receive permission relay requests. When declared, Claude Code forwards tool approval prompts to your channel so you can approve or deny them remotely. |
| `capabilities.tools` | `object` | Two-way only. Always `{}`. Standard MCP tool capability. |
| `instructions` | `string` | Recommended. Added to Claude's system prompt. Tell Claude what events to expect, what the `<channel>` tag attributes mean, whether to reply, and if so which tool to use and which attribute to pass back (like `chat_id`). |

To create a one-way channel, omit `capabilities.tools`.

### Example: Two-way setup

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

const mcp = new Server(
  { name: 'your-channel', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},  // omit for one-way channels
    },
    instructions: 'Messages arrive as <channel source="your-channel" ...>. Reply with the reply tool.',
  },
)
```

To push an event, call `mcp.notification()` with method `notifications/claude/channel`. The params are in the next section.

---

## Notification Format

Your server emits `notifications/claude/channel` with two params:

| Field | Type | Description |
|:------|:-----|:------------|
| `content` | `string` | The event body. Delivered as body of `<channel>` tag. |
| `meta` | `Record<string, string>` | Optional. Each entry becomes an attribute on the `<channel>` tag for routing context like chat ID, sender name, or alert severity. Keys must be identifiers: letters, digits, and underscores only. Keys containing hyphens or other characters are silently dropped. |

### Example

```ts
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'build failed on main: https://ci.example.com/run/1234',
    meta: { severity: 'high', run_id: '1234' },
  },
})
```

Arrives as:
```
<channel source="your-channel" severity="high" run_id="1234">
build failed on main: https://ci.example.com/run/1234
</channel>
```

The `source` attribute is set automatically from the server's configured name.

---

## Expose a Reply Tool (Two-Way Channels)

If your channel is two-way (like a chat bridge rather than an alert forwarder), expose a standard [MCP tool](https://modelcontextprotocol.io/docs/concepts/tools) that Claude can call to send messages back. Nothing about the tool registration is channel-specific. A reply tool has three components:

### 1. Enable tool discovery

```ts
capabilities: {
  experimental: { 'claude/channel': {} },
  tools: {},  // enables tool discovery
},
```

### 2. Register the reply tool

The `import` goes at the top of the file with your other imports; the two handlers go between the `Server` constructor and `mcp.connect()`:

```ts
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// Claude queries this at startup to discover what tools your server offers
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The conversation to reply in' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))

// Tool execution handler
mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    send(`Reply to ${chat_id}: ${text}`)
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})
```

### 3. Update the instructions

```ts
instructions: 'Messages arrive as <channel source="webhook" chat_id="...">. Reply with the reply tool, passing the chat_id from the tag.'
```

### Full Two-Way webhook.ts

Outbound replies stream over `GET /events` using [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE), so `curl -N localhost:8788/events` can watch them live; inbound chat arrives on `POST /`:

```ts
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// Outbound: SSE broadcast to curl -N listeners on /events
const listeners = new Set<(chunk: string) => void>()
function send(text: string) {
  const chunk = text.split('\n').map(l => `data: ${l}\n`).join('') + '\n'
  for (const emit of listeners) emit(chunk)
}

const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: 'Messages arrive as <channel source="webhook" chat_id="...">. Reply with the reply tool, passing the chat_id from the tag.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The conversation to reply in' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    send(`Reply to ${chat_id}: ${text}`)
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

await mcp.connect(new StdioServerTransport())

let nextId = 1
Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)

    // GET /events: SSE stream for watching replies live
    if (req.method === 'GET' && url.pathname === '/events') {
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(': connected\n\n')
          const emit = (chunk: string) => ctrl.enqueue(chunk)
          listeners.add(emit)
          req.signal.addEventListener('abort', () => listeners.delete(emit))
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    // POST: forward to Claude as a channel event
    const body = await req.text()
    const chat_id = String(nextId++)
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { chat_id, path: url.pathname, method: req.method },
      },
    })
    return new Response('ok')
  },
})
```

---

## Gate Inbound Messages

An ungated channel is a **prompt injection vector**. Anyone who can reach your endpoint can put text in front of Claude. A channel listening to a chat platform or a public endpoint needs a real sender check before it emits anything.

**Gate on the sender's identity, not the chat or room identity**: `message.from.id` in the example, not `message.chat.id`. In group chats, these differ, and gating on the room would let anyone in an allowlisted group inject messages into the session.

```ts
const allowed = new Set(loadAllowlist())

// inside your message handler, before emitting:
if (!allowed.has(message.from.id)) {
  return  // drop silently
}
await mcp.notification({ ... })
```

### Platform-specific gating approaches:
- **[Telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) & [Discord](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord)**: Gate on sender allowlist. Bootstrap the list by pairing: user DMs the bot, bot replies with a pairing code, user approves it in their Claude Code session, and their platform ID is added.
- **[iMessage](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/imessage)**: Detects the user's own addresses from the Messages database at startup and lets them through automatically, with other senders added by handle.

---

## Relay Permission Prompts

> Requires **Claude Code v2.1.81+**

When Claude calls a tool that needs approval, the local terminal dialog opens and the session waits. A two-way channel can opt in to receive the same prompt in parallel and relay it to you on another device. Both stay live: you can answer in the terminal or on your phone, and Claude Code applies whichever answer arrives first and closes the other.

**Relay covers**: Tool-use approvals like `Bash`, `Write`, and `Edit`.
**Does NOT relay**: Project trust and MCP server consent dialogs; those only appear in the local terminal.

### How Relay Works

1. Claude Code generates a short request ID and notifies your server
2. Your server forwards the prompt and ID to your chat app
3. The remote user replies with a yes or no and that ID
4. Your inbound handler parses the reply into a verdict, and Claude Code applies it only if the ID matches an open request

The local terminal dialog stays open through all of this. If someone at the terminal answers before the remote verdict arrives, that answer is applied instead and the pending remote request is dropped.

> **Sequence diagram**: Claude Code sends a `permission_request` notification to the channel server, the server formats and sends the prompt to the chat app, the human replies with a verdict, and the server parses that reply into a permission notification back to Claude Code. (SVG at `en/images/channel-permission-relay.svg`, 600x230)

### Permission Request Fields

The outbound notification from Claude Code is `notifications/claude/channel/permission_request`. Like the channel notification, the transport is standard MCP but the method and schema are Claude Code extensions. The `params` object has four string fields:

| Field | Description |
|:------|:------------|
| `request_id` | Five lowercase letters drawn from `a`-`z` without `l`, so it never reads as a `1` or `I` when typed on a phone. Include it in your outgoing prompt so it can be echoed in the reply. Claude Code only accepts a verdict that carries an ID it issued. The local terminal dialog doesn't display this ID, so your outbound handler is the only way to learn it. |
| `tool_name` | Name of the tool Claude wants to use, for example `Bash` or `Write`. |
| `description` | Human-readable summary of what this specific tool call does, the same text the local terminal dialog shows. For a Bash call this is Claude's description of the command, or the command itself if none was given. |
| `input_preview` | The tool's arguments as a JSON string, truncated to 200 characters. For Bash this is the command; for Write it's the file path and a prefix of the content. Omit it from your prompt if you only have room for a one-line message. Your server decides what to show. |

### Permission Verdict

The verdict your server sends back is `notifications/claude/channel/permission` with two fields:

| Field | Value |
|:------|:------|
| `request_id` | Echo the ID from the request |
| `behavior` | `'allow'` or `'deny'` |

Allow lets the tool call proceed; deny rejects it, the same as answering No in the local dialog. **Neither verdict affects future calls.**

### Add Relay to a Chat Bridge

Adding permission relay to a two-way channel takes three components:

1. A `claude/channel/permission: {}` entry under `experimental` capabilities so Claude Code knows to forward prompts
2. A notification handler for `notifications/claude/channel/permission_request` that formats the prompt and sends it out
3. A check in your inbound message handler that recognizes `yes <id>` or `no <id>` and emits a verdict instead of forwarding

> **Security**: Only declare the capability if your channel authenticates the sender, because anyone who can reply through your channel can approve or deny tool use in your session.

#### 1. Declare the permission capability

```ts
capabilities: {
  experimental: {
    'claude/channel': {},
    'claude/channel/permission': {},  // opt in to permission relay
  },
  tools: {},
},
```

#### 2. Handle incoming permission requests

Register a notification handler between your `Server` constructor and `mcp.connect()`. `setNotificationHandler` routes by `z.literal` on the method field, so this schema is both the validator and the dispatch key:

```ts
import { z } from 'zod'

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
  send(
    `Claude wants to run ${params.tool_name}: ${params.description}\n\n` +
    `Reply "yes ${params.request_id}" or "no ${params.request_id}"`,
  )
})
```

#### 3. Intercept verdict in inbound handler

Your inbound handler is the loop or callback that receives messages from your platform. Add a check before the chat-forwarding call that recognizes the verdict format and emits the permission notification instead. The regex matches the ID format Claude Code generates: five letters, never `l`. The `/i` flag tolerates phone autocorrect capitalizing the reply; lowercase the captured ID before sending it back:

```ts
// matches "y abcde", "yes abcde", "n abcde", "no abcde"
// [a-km-z] is the ID alphabet Claude Code uses (lowercase, skips 'l')
// /i tolerates phone autocorrect; lowercase the capture before sending
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

async function onInbound(message: PlatformMessage) {
  if (!allowed.has(message.from.id)) return

  const m = PERMISSION_REPLY_RE.exec(message.text)
  if (m) {
    await mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: m[2].toLowerCase(),
        behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
      },
    })
    return  // handled as verdict, don't forward as chat
  }

  // normal chat path
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content: message.text, meta: { chat_id: String(message.chat.id) } },
  })
}
```

### Failed verdict scenarios:
- **Different format**: Regex doesn't match, text falls through as normal message to Claude.
- **Right format, wrong ID**: Verdict emitted but Claude Code finds no open request with that ID, drops silently.

---

## Full Example: Two-Way + Gating + Permission Relay

```ts
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

// --- Outbound: SSE broadcast ---
const listeners = new Set<(chunk: string) => void>()
function send(text: string) {
  const chunk = text.split('\n').map(l => `data: ${l}\n`).join('') + '\n'
  for (const emit of listeners) emit(chunk)
}

// Sender allowlist
const allowed = new Set(['dev'])

const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="webhook" chat_id="...">. ' +
      'Reply with the reply tool, passing the chat_id from the tag.',
  },
)

// --- Reply tool ---
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The conversation to reply in' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    send(`Reply to ${chat_id}: ${text}`)
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

// --- Permission relay handler ---
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
  send(
    `Claude wants to run ${params.tool_name}: ${params.description}\n\n` +
    `Reply "yes ${params.request_id}" or "no ${params.request_id}"`,
  )
})

await mcp.connect(new StdioServerTransport())

// --- HTTP server ---
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
let nextId = 1

Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)

    // GET /events: SSE stream
    if (req.method === 'GET' && url.pathname === '/events') {
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(': connected\n\n')
          const emit = (chunk: string) => ctrl.enqueue(chunk)
          listeners.add(emit)
          req.signal.addEventListener('abort', () => listeners.delete(emit))
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    // Inbound: gate on sender
    const body = await req.text()
    const sender = req.headers.get('X-Sender') ?? ''
    if (!allowed.has(sender)) return new Response('forbidden', { status: 403 })

    // Check for permission verdict
    const m = PERMISSION_REPLY_RE.exec(body)
    if (m) {
      await mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: m[2].toLowerCase(),
          behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
        },
      })
      return new Response('verdict recorded')
    }

    // Normal chat: forward to Claude
    const chat_id = String(nextId++)
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: { content: body, meta: { chat_id, path: url.pathname } },
    })
    return new Response('ok')
  },
})
```

### Testing the full example

```bash
# Terminal 1: Start Claude Code
claude --dangerously-load-development-channels server:webhook

# Terminal 2: Watch outbound
curl -N localhost:8788/events

# Terminal 3: Send a message
curl -d "list the files in this directory" -H "X-Sender: dev" localhost:8788

# Terminal 3: Approve permission (replace <id> with actual ID from /events stream)
curl -d "yes <id>" -H "X-Sender: dev" localhost:8788
```

**The three channel-specific pieces in the full example:**

- **Capabilities** in the `Server` constructor: `claude/channel` registers the notification listener, `claude/channel/permission` opts in to permission relay, `tools` lets Claude discover the reply tool.
- **Outbound paths**: the `reply` tool handler is what Claude calls for conversational responses; the `PermissionRequestSchema` notification handler is what Claude Code calls when a permission dialog opens. Both call `send()` to broadcast over `/events`, but they're triggered by different parts of the system.
- **HTTP handler**: `GET /events` holds an SSE stream open so curl can watch outbound live; `POST` is inbound, gated on the `X-Sender` header. A `yes <id>` or `no <id>` body goes to Claude Code as a verdict notification and never reaches Claude; anything else is forwarded to Claude as a channel event.

---

## Package as a Plugin

To make your channel installable and shareable, wrap it in a [plugin](/en/plugins) and publish it to a [marketplace](/en/plugin-marketplaces). Users install it with `/plugin install`, then enable it per session with `--channels plugin:<name>@<marketplace>`.

A channel published to your own marketplace still needs `--dangerously-load-development-channels` to run, since it isn't on the approved allowlist (`/en/channels#supported-channels`). To get it added, [submit it to the official marketplace](/en/plugins#submit-your-plugin-to-the-official-marketplace). Channel plugins go through security review before being approved.

---

## Built-in Channels (Research Preview)

Telegram, Discord, iMessage, and fakechat are included in the research preview.

- [Working channel implementations](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins) - Complete server code with pairing flows, reply tools, and file attachments.
- [fakechat server](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat) - Web UI demo with file attachments and reply tool.

---

## See Also

- [Channels](/en/channels) — Install and use Telegram, Discord, iMessage, or the fakechat demo, and to enable channels for a Team or Enterprise org
- [Working channel implementations](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins) — Complete server code with pairing flows, reply tools, and file attachments
- [MCP](/en/mcp) — The underlying protocol that channel servers implement
- [Plugins](/en/plugins) — Package your channel so users can install it with `/plugin install`
