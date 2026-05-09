---
name: feishu-codex-bridge-ops
description: Use when operating, diagnosing, upgrading, or documenting the Windows Feishu-to-Codex bridge that accepts Feishu bot messages, runs Codex CLI locally, and replies back through Feishu.
---

# Feishu Codex Bridge Ops

Operate and upgrade the Windows Feishu Codex bridge without re-learning the same platform and runtime pitfalls.

## Trigger Conditions

- Use when the task involves this repo's Feishu bot bridge on Windows.
- Use when the user asks to run, diagnose, package, harden, or upgrade the bridge service.
- Use when the work touches Feishu long-connection behavior, Codex CLI spawning, local task persistence, conversation/session persistence, or bridge runtime policy.
- Use when future AI handoff or archival documentation for this bridge must stay consistent with verified behavior.

## Required Handling

1. Read `references/bridge-architecture.md` first for the component map and runtime contract.
2. Read `references/bridge-operations.md` before changing docs, service procedures, or upgrade guidance.
3. Run `scripts/verify-bridge-skill-target.ps1` to confirm the workspace matches the expected bridge project before giving repo-specific instructions.
4. Base all operational guidance on the actual command surface and tested behavior in this repo, not on generic Feishu bot assumptions.
5. Preserve the bridge's safety model: allowlist first, absolute workspace root, `/ask` read-only, `/run` scoped to the configured workspace root.
6. When documenting the conversation-flow upgrade, describe the bridge as a local-visible, resumable session system keyed by Feishu `chatId`, not only as a task queue.
7. Call out both local session mirrors explicitly:
   - `%LOCALAPPDATA%\feishu-codex-bridge\data\conversations.json`
   - `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`
8. When documenting upgrades or fixes, capture the Windows-specific Codex invocation behavior and Feishu message-normalization rules explicitly.
9. If you produce archival or handoff notes, point to one canonical archive location instead of duplicating copies, and note that Obsidian sync is best-effort rather than runtime-critical.

## Output Contract

- State the relevant bridge area clearly: architecture, operations, pitfalls, or upgrade path.
- Include concrete Windows and Feishu constraints when they affect the answer.
- Distinguish verified behavior from inference or future guidance.
- Mention the session-oriented command surface when relevant:
  - `/session`
  - `/sessions`
  - `/history [count]`
- Return exact file paths or commands when the user needs operational follow-through.

## Do Not

- Do not assume webhook mode or public callback infrastructure; this bridge uses Feishu long connection mode.
- Do not recommend running Codex outside `CODEX_WORKSPACE_ROOT` or weakening the allowlist model.
- Do not ignore Windows spawn behavior, especially the `codex.cmd` and PowerShell/Node entrypoint nuances.
- Do not describe the upgraded bridge as task-id-only if the conversation/session flow is the topic.
- Do not write duplicate archive copies across multiple vault locations.

## Load These Files

- `references/bridge-architecture.md` for the runtime design and verified component responsibilities
- `references/bridge-operations.md` for startup, health checks, task flow, pitfalls, and upgrade guidance
- `scripts/verify-bridge-skill-target.ps1` for deterministic workspace verification
