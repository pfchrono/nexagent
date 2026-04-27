# Internal Tool Registry Runtime Spec

Define real internal tool-calling runtime for `nexagent`.

Must cover:

- tool registry shape
  - tool id
  - description
  - JSON schema
  - handler
  - safety mode
- tool execution loop
  - provider response requests tool
  - runtime executes tool
  - tool result appended back into model loop
  - final assistant response after tool turns
- first tool set
  - `read_file`
  - `search_content`
  - `search_files`
  - `list_dir`
  - `git_status`
  - later `shell_command`
- safety policy integration
  - allowed roots
  - protected roots
  - shell command allow/deny rules
  - visible approval/error surface
- prompt guidance
  - model should call tools instead of narrating intent
  - keep provider-specific tool-use guidance honest
- output shaping
  - deterministic truncation
  - cap large search outputs
  - path normalization
- debug/operator surface
  - optional slash wrappers call same internal handlers
  - no duplicate logic

Donor refs:

- `/home/pfchrono/code/free-code/src/tools.ts`
- `/home/pfchrono/code/hermes-agent/model_tools.py`
- `/home/pfchrono/code/hermes-agent/toolsets.py`
- `/home/pfchrono/code/hermes-agent/tools/file_operations.py`
- `/home/pfchrono/code/codex-fresh/docs/config.md`
