# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This repo is for building **Claude Code Channels** — MCP servers that push webhooks, alerts, and chat messages into Claude Code sessions. Channels run as subprocesses spawned by Claude Code over stdio.

## Key Reference

The authoritative reference lives at `.claude/doc/claude-code-channels.md`. Read it for exact API details, notification formats, and full examples. A skill is available at `.claude/skills/channels/SKILL.md` — invoke with `/channels`.

## Architecture

A channel is an MCP server using `@modelcontextprotocol/sdk` that:
1. Declares `capabilities.experimental['claude/channel']: {}` to register as a channel
2. Connects to Claude Code over `StdioServerTransport` (stdio)
3. Emits `notifications/claude/channel` events with `content` (string) and optional `meta` (key-value attributes)

**Channel types:**
- **One-way**: Forward-only (webhooks, alerts). No `capabilities.tools`.
- **Two-way**: Adds a reply tool via standard MCP `ListToolsRequestSchema`/`CallToolRequestSchema`. Requires `capabilities.tools: {}`.
- **Two-way + permission relay**: Also declares `capabilities.experimental['claude/channel/permission']: {}` to receive and respond to tool-approval prompts remotely. Requires Claude Code v2.1.81+.

## Development

Channels require **Bun**, **Node**, or **Deno** with `@modelcontextprotocol/sdk`. The research preview examples use Bun.

```bash
# Install dependencies
bun add @modelcontextprotocol/sdk

# Register in .mcp.json (project-level)
# { "mcpServers": { "my-channel": { "command": "bun", "args": ["./channel.ts"] } } }

# Test during research preview (custom channels aren't on the approved allowlist)
claude --dangerously-load-development-channels server:my-channel
```

## Security

- **Sender gating is critical.** Gate on `message.from.id` (sender identity), NOT `message.chat.id` (room). Ungated channels are prompt injection vectors.
- Meta keys must be identifiers: letters, digits, underscores only. Keys with hyphens are silently dropped.
- Permission relay `request_id` format: 5 lowercase letters from a-z excluding `l`. Regex: `/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 2a. Subagent Mandatory Rules

Every subagent prompt MUST include these rules:

- **Follow specs literally:** When an RFC/spec exists, subagents MUST follow it exactly. If a subagent believes a different approach is better, it must NOT implement the deviation — only flag it in its output and explain its reasoning. Wait for human approval before changing the approach.
- **Never use `any` or `unknown` type casts:** Access model/interface properties via their declared types. If a property isn't available on the type, extend the interface rather than casting through `any` or `unknown`. Use `Object.assign()` to add extra properties to typed objects instead of spreading + casting back through `unknown`.

### 3. Self-Improvement Loop

- After ANY correction from the user: update '.claude/tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told ho