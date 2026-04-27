# Internal Tooling Donor Map

Goal: move `nexagent` from operator slash commands toward real internal agent tools the model can call during turn execution.

Key donor truths:

- `free-code`
  - central tool registry in `src/tools.ts`
  - strong core local coding tools:
    - bash
    - file read
    - file edit
    - file write
    - glob
    - grep
- `hermes-agent`
  - central orchestration in `model_tools.py`
  - file/search tools grouped in toolsets
  - file-name search prefers `rg --files -g`
  - content search prefers `rg -n`
  - policy and dangerous-command handling live beside tool execution, not only UI
- `codex-fresh`
  - useful reference for tool approval and tool-call normalization
  - not primary donor for local codebase tools

Best first internal tool candidates for `nexagent`:

1. `read_file`
2. `search_content`
   - repo-local
   - backed by `rg -n`
3. `search_files`
   - repo-local
   - backed by `rg --files -g`
4. `list_dir`
5. `shell_command`
   - heavily policy-gated
   - limited command surface
6. `git_status`
   - branch
   - dirty state
   - ahead/behind
   - pull-needed

Design direction:

- real internal registry first
- provider tool-call loop second
- slash wrappers only as optional debug/operator surface
- same repo-local safety policy must gate both internal tools and any operator commands

Truth boundary:

- current `nexagent` still has slash-command runtime, not true internal tool-calling loop
- current `/glob` and `/rg` shape is debug/operator surface only
- future phase should reframe those as wrappers over internal tool implementations, not primary interface
