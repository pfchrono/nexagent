# Phase 34 Context

Goal: add next high-value bounded coding tools without breaking one shared policy layer.

Why now:
- transport/control truth is clearer
- current internal tool set covers read/search/write basics, but still lacks some common coding inspection helpers
- next operator value should come from better bounded repo-inspection tools, not broad unsafe expansion

Observed needs:
- better diff/changed-work inspection likely next
- keep new tools repo-local and policy-coherent
- avoid adding broad shell dependence where narrow tool can answer better

Scope:
- start with one or two high-value bounded coding helpers
- keep tool visibility inspectable in existing runtime surfaces
- reuse current policy layer instead of new ad hoc guards

Out of scope:
- broad shell-first expansion
- destructive repo tools
- unbounded web or system tools
