---
name: channels
description: Build, configure, debug, and understand Claude Code Channels — MCP servers that push webhooks, alerts, and chat messages into Claude Code sessions. Use when working with channel servers, notification events, reply tools, sender gating, or permission relay.
user-invocable: true
argument-hint: "[one-way|two-way|webhook|reply-tool|gating|permissions|debug|full]"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Claude Code Channels — Expert Knowledge

You are an expert on Claude Code Channels. Use the comprehensive reference at `${CLAUDE_SKILL_DIR}/../doc/claude-code-channels.md` as your source of truth. Read it when you need exact details.

## Quick Reference

A **channel** is an MCP server that pushes events into a Claude Code session. Claude Code spawns it as a subprocess over stdio. Requires **v2.1.80+**, claude.ai login, and `@modelcontextprotocol/sdk`.

### Channel Types
- **One-way**: Forward alerts/webhooks/monitoring. No `capabilities.tools`.
- **Two-way**: Expose a reply tool so Claude responds back. Add `capabilities.tools: {}`.
- **Two-way + permissions**: Also relay tool-approval prompts remotely. Add `capabilities.experimental['claude/channel/permission']: {}`.

### Core Contract

```ts
// Minimum viable channel
const mcp = new Server(
  { name: 'my-channel', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: 'Events arrive as <channel source="my-channel" ...>. One-way: act on them.',
  },
)
await mcp.connect(new StdioServerTransport())
```

### Notification Format

```ts
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'event body text',           // becomes <channel> tag body
    meta: { key: 'value' },               // each key becomes a tag attribute
  },                                       // meta keys: letters/digits/underscores only
})
```

### Reply Tool Pattern

```ts
// 1. Add tools: {} to capabilities
// 2. Register ListToolsRequestSchema + CallToolRequestSchema handlers
// 3. Update instructions to tell Claude which tool to call and which meta attribute to pass back
```

### Permission Relay (v2.1.81+)

- Notification: `notifications/claude/channel/permission_request` with `request_id`, `tool_name`, `description`, `input_preview`
- Verdict: `notifications/claude/channel/permission` with `request_id` + `behavior` (`'allow'`/`'deny'`)
- `request_id`: 5 lowercase letters from a-z excluding `l`
- Regex: `/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`

### Security: Sender Gating

Gate on `message.from.id` (sender), NOT `message.chat.id` (room). Ungated channels are prompt injection vectors.

### MCP Config Registration

```json
// .mcp.json (project-level, relative path) or ~/.claude.json (user-level, absolute path)
{ "mcpServers": { "my-channel": { "command": "bun", "args": ["./channel.ts"] } } }
```

### Testing

```bash
claude --dangerously-load-development-channels server:my-channel
```

Flag is per-entry. `channelsEnabled` org policy still applies. Bypass does NOT extend to `--channels` entries.

---

## How to Use This Skill

Based on `$ARGUMENTS`, do the following:

### `one-way` or `webhook`
Help build a one-way channel server. Generate a complete `webhook.ts` that declares `claude/channel`, connects over stdio, and listens on a local HTTP port. Include `.mcp.json` config. Reference the webhook receiver example in the doc.

### `two-way` or `reply-tool`
Help build a two-way channel with a reply tool. Include `tools: {}` capability, `ListToolsRequestSchema`/`CallToolRequestSchema` handlers, SSE outbound via `/events`, and instructions telling Claude how to route replies. Reference the full two-way example.

### `gating`
Help implement sender gating/allowlisting. Show the pattern for checking `message.from.id` before emitting. Explain the pairing flow (Telegram/Discord) vs auto-detect (iMessage) approaches.

### `permissions`
Help implement permission relay. Add `claude/channel/permission: {}` capability, `PermissionRequestSchema` notification handler with zod, and verdict interception in the inbound handler. Explain the ID format, regex, and failure modes.

### `debug`
Help debug a channel that isn't working. Check:
1. Server status via `/mcp` command
2. Debug logs at `~/.claude/debug/<session-id>.txt`
3. Port binding (`lsof -i :<port>`)
4. MCP config correctness
5. Capability declaration
6. Development flag usage

### `full`
Generate a complete channel server with ALL features: reply tool, sender gating, permission relay, SSE outbound, and HTTP inbound. This is the assembled example from the reference doc.

### No argument or other
Read the user's request carefully and apply channel knowledge as needed. If they're building a channel, determine which type and guide them. If they have a bug, diagnose it. Always reference the official patterns from the doc.
