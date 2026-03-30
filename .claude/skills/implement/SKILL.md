---
name: implement
description: Full-stack implementation pipeline that transforms a task (Jira ticket or conversation context) into a complete, approved implementation plan. Runs requirements analysis, impact analysis, architectural design, and specialist phase planning sequentially with user approval gates. Use when the user says 'implement', 'implement this', 'implement task', '/implement CNA-XXXX', or wants to go from idea to implementation plan.
---

# /implement — Full Implementation Pipeline

Orchestrate the complete journey from task description to approved implementation phases. This skill runs sequential steps, **stopping for user approval between each one**.

> **No code generation.** This pipeline produces analysis and plans only. Implementation comes after full approval.

---

## Workflow Orchestration

> **Source of truth:** `CLAUDE.md` → "Workflow Orchestration" section.
>
> Before executing any step in this pipeline, read `CLAUDE.md` and follow ALL rules in: **Plan Mode Default** (§1), **Subagent Mandatory Rules** (§2a), **Self-Improvement Loop** (§3), **Verification Before Done** (§4), and **Demand Elegance** (§5).
>
> Every sub-agent prompt MUST include the mandatory rules from `CLAUDE.md` §2a verbatim. Read them from `CLAUDE.md` at execution time — do NOT use hardcoded copies.

---

## Input Modes

### Option 1: Jira Ticket

```
/implement CNA-XXXX "short description of the task"
```

- Extract the **CNA ID** and **description** from arguments
- If either is missing, **ask the user** before proceeding

### Option 2: Session Context

```
/implement "use the conversation about candidate_id_number being null"
```

- Synthesize the relevant conversation context into a task description
- **Ask the user for a CNA ID** (or a slug name if no ticket exists)
- If no CNA ID → ask: _"Bro, what's the Jira ticket ID for this? If there's no ticket yet, give me a short name (e.g., 'candidate-id-number-fix') and I'll use that."_

---

## Output Location

All artifacts are saved to: `.claude/docs/ai/<CNA-ID or slug>/`

| Step | File | Description |
|------|------|-------------|
| 1 | `requirements-spec.md` | Requirements analysis |
| 2 | `implementation-plan.md` | Architectural implementation plan |
| 3 | `NNNa_backend_phases.md` | Backend implementation phases (if applicable) |
| 3 | `NNNb_frontend_phases.md` | Frontend implementation phases (if applicable) |

The `NNN` prefix is auto-incremented based on existing numbered files in the folder (start at `001`).

---

## Pipeline Steps

### Step 0: Resolve Input + Resume Detection

1. **Determine input mode** (Option 1 or Option 2)
2. **Extract or ask for** CNA ID and description
3. **Create the output folder** `.claude/docs/ai/<CNA-ID>/` if it doesn't exist
4. **Check for existing artifacts** in the folder:
   - If `requirements-spec.md` exists → ask: _"Bro, a requirements spec already exists for this task. Should I use it and skip to Step 2, or regenerate it?"_
   - If `implementation-plan.md` also exists → ask: _"Bro, an implementation plan already exists too. Skip to Step 3 (phases), or redo from Step 2?"_
   - This allows resuming a pipeline interrupted in a previous session

---

### Step 1: Requirements Analysis

**Use a sub-agent** (`subagent_type: "backend"` or `"general-purpose"`) with the instructions from the `/requirements-analyst` skill (`.claude/skills/requirements-analyst/SKILL.md`).

> **Why a sub-agent, not the skill directly?** Skills run in the main conversation context and cannot be invoked from within another skill. Use a sub-agent that reads and follows the requirements-analyst SKILL.md instructions.

The sub-agent should:
1. Read `.claude/skills/requirements-analyst/SKILL.md` for the analysis framework
2. Explore the codebase for existing patterns (as the requirements-analyst instructions require)
3. Include session context if available (Option 2)
4. Write output to `.claude/docs/ai/<CNA-ID>/requirements-spec.md`

**Task type detection:** If the task is a **bug fix** with a known root cause (e.g., from session context), tell the sub-agent to use a lighter spec — skip sections that don't apply (e.g., Communication Template, extensive Use Cases for obvious fixes). The spec should match the task's complexity, not a fixed template.

**APPROVAL GATE:**

```
Requirements analysis complete for <CNA-ID>.

Summary:
- Complexity: <rating>
- Scope: <backend/frontend/both>
- Key risks: <top 2-3>
- Open questions: <count>

Spec saved to: .claude/docs/ai/<CNA-ID>/requirements-spec.md

Bro, review the spec and let me know when you're ready for the impact analysis and architectural plan. Any changes needed?
```

**STOP and wait for user approval before proceeding.**

---

### Step 2: Impact Analysis + Architectural Plan

Use the **architect sub-agent** (`subagent_type: "architect"`) to:

1. **Read the requirements spec** from Step 1
2. **Analyze the impact** — which components, modules, files, and database tables are affected
3. **Create the implementation plan** with:
   - Affected files (with line numbers)
   - Database changes (if any)
   - API changes (if any)
   - Frontend changes (if any)
   - Dependencies between changes
   - **Scope determination:** Explicitly tag: `BACKEND`, `FRONTEND`, or `BOTH`

> Sub-agent prompt MUST include the mandatory rules from `CLAUDE.md` §2a (read them from `CLAUDE.md` at execution time).

**Save output to:** `.claude/docs/ai/<CNA-ID>/implementation-plan.md`

**APPROVAL GATE:**

```
Implementation plan complete for <CNA-ID>.

Scope: <BACKEND / FRONTEND / BOTH>
Affected modules: <list>
Database changes: <yes/no + summary>
API changes: <yes/no + summary>
Files to modify: <count>

Plan saved to: .claude/docs/ai/<CNA-ID>/implementation-plan.md

Bro, review the plan. When you're ready, I'll create the detailed implementation phases. Any changes?
```

**STOP and wait for user approval before proceeding.**

---

### Step 3: Specialist Implementation Phases

Based on the **scope determined in Step 2**, invoke specialist sub-agents to create phase-by-phase implementation plans (**no code, only phases**).

> Sub-agent prompts MUST include the mandatory rules from `CLAUDE.md` §2a (read at execution time) plus: **Do NOT generate code — only describe phases, steps, file locations, and what needs to change.**

#### Scope: BACKEND only

Use **backend sub-agent** (`subagent_type: "backend"`):
- Read requirements spec AND implementation plan
- Save to: `.claude/docs/ai/<CNA-ID>/NNNa_backend_phases.md`

#### Scope: FRONTEND only

Use **frontend sub-agent** (`subagent_type: "frontend"`):
- Read requirements spec AND implementation plan
- Save to: `.claude/docs/ai/<CNA-ID>/NNNb_frontend_phases.md`

#### Scope: BOTH (backend + frontend)

**CRITICAL: Run SEQUENTIALLY, not in parallel.**

> Backend phases MUST be created first because frontend phases depend on API contracts, DTOs, and data structures defined in the backend plan. Running in parallel risks inconsistencies (e.g., frontend assuming a response shape the backend defines differently). Backend establishes the contract, frontend consumes it.

1. **First:** Run **backend sub-agent** → save `NNNa_backend_phases.md`
2. **Then:** Run **frontend sub-agent** with access to the implementation plan AND the backend phases → save `NNNb_frontend_phases.md`

#### Phase structure

Each sub-agent must produce phases with:
- **Goal:** What this phase accomplishes
- **Dependencies:** What must be done before this phase
- **Steps:** Numbered steps (Step N.1, N.2, etc.) with file path, line number/method, and description of what to do
- **Verification:** How to verify this phase is complete (commands, checks)

Output format should follow the structure in `.claude/rfc/001a_backend_implementation_phases.md`.

**APPROVAL GATE:**

```
Implementation phases complete for <CNA-ID>.

Files created:
<list files created with paths>

Phase summary:
- Backend: <N phases> (if applicable)
- Frontend: <N phases> (if applicable)

Bro, review the phases. When everything looks good, we can start implementation. Any changes?
```

**STOP. Pipeline complete.**

---

## Auto-Numbering Logic

When saving `NNNa_*.md` or `NNNb_*.md` files:

1. List existing files in `.claude/docs/ai/<CNA-ID>/` matching pattern `[0-9][0-9][0-9]*.md`
2. Find the highest number prefix
3. Increment by 1 for the new file
4. If no numbered files exist, start at `001`

---

## Error Handling

- If a sub-agent fails or returns incomplete results, **do not proceed** — report the issue to the user
- If the user rejects a step, **ask what needs to change** and re-run that step only
- If the requirements spec reveals the task is too vague, **stop at Step 1** and present the open questions

---

## Quick Reference

```
/implement CNA-10700 "add rating system for suppliers"
/implement "fix the candidate_id_number null issue we discussed"
```

Pipeline: Input → [resume check] → Requirements → [approval] → Architect → [approval] → Phases → [approval] → Done
