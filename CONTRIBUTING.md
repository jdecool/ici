# Contributing

Read AGENTS.md and the applicable backend/frontend instructions. The same development rules apply to humans and agents.

1. Start the application with `make dev` and inspect existing behavior.
2. Make a focused change in its capability slice. Add behavior tests and update contracts/documentation together.
3. Run focused tests while iterating, then `make quality` before submitting.
4. Describe the problem, resulting behavior, validation performed, and any boundary/dependency changes in the PR.

Use English, imperative commit subjects (for example, `Add greeting endpoint`). No commit hook installation or external publication happens implicitly. CI is the authoritative gate and runs full mutations on every PR.

Dependency changes must include updated lockfiles. For initial resolution use `make bootstrap`. To update selected packages later, use Cargo/npm in the tool containers and review the lockfile diff. Never replace a locked CI install with an unrestricted install. Keep Playwright's package and Docker image versions identical.

Do not reduce quality thresholds or add broad exclusions to make checks pass. Document justified technical exclusions in docs/quality.md and explain them in the PR. No application feature or adapter is exempt from tests or mutation analysis.
