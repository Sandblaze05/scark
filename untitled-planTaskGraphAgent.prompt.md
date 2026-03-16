## Plan: Task-Graph Agent + Standardized Tool Registry

TL;DR - Replace the current fixed roadmap with a task-graph-driven agent that iteratively updates a task graph, selects and executes best tasks, reflects, and updates confidence. Introduce a centralized tool registry (JSON + implementation bindings) so planners and executors use a stable machine-readable tool schema.

**Steps**
1. Discovery & alignment (complete) — scanned repo for relevant files: `renderer/lib/agentLoop.js`, `renderer/lib/webllm.js`, `workers/*`, `services/*` (Chroma + SQLite). Found current flow is prompt-driven planning and string-based tools. (*done*)
2. Design schema (this plan) — define JSON schemas for: ToolManifest, TaskNode, TaskGraph, TaskResult, AgentState. Ensure fields for dependencies, retries, status, and result types.
3. Add `toolRegistry` module — implement `renderer/lib/toolRegistry.js` that exports:
   - `registerTool(manifest)` — registers tool metadata and runner
   - `getTool(id)` — returns manifest + runner
   - `listTools()` — returns registry manifest list
   - runner signature: `async runTool(ctx, args)`
   *depends on step 2*
4. Task graph module — implement `renderer/lib/taskGraph.js` with in-memory & optional SQLite persistence (`agent_tasks` table). Expose:
   - `createTaskNode(node)`
   - `updateTaskNode(id, patch)`
   - `getExecutableNodes()` — returns pending nodes whose deps are completed
   - `markCompleted(id, result)` / `markFailed(id, err)`
   - `loadFromPersistent()` / `persistNode()` (optional)
   *parallel with step 3*
5. Agent loop refactor (adapter layer) — update `renderer/lib/agentLoop.js` to use the task graph modules and tool registry instead of free-text planActions:
   - Replace ad-hoc `planActions()` parsing with a structured `planToTaskNodes(goal)` function that returns TaskNodes (LLM asked to emit JSON matching TaskNode schema).
   - Loop implementation (high-level):
     1) update task graph (ingest planner output)
     2) select best task (`getExecutableNodes()` + simple priority heuristic)
     3) execute via `toolRegistry.getTool(task.toolId).run(ctx, args)`
     4) update task node & agent memory
     5) reflect: call small LLM reflection to produce new tasks or update confidence
     6) update confidence / stop when threshold or no pending
   - Keep backward-compatible executeTool wrappers to minimize landing surface.
6. LLM planner adjustments — change `planActions()` usage in `webllm.js` to request structured JSON matching TaskNode schema and validating with JSON Schema. Provide example prompt + schema.
7. Standardize tool results & schemas — define constrained result types (searchResults, pageText, kbMatches, summary, boolean) and implement adapters in each tool runner to normalize outputs.
8. Persistence & long-term memory (opt) — add `agent_state` and `agent_tasks` tables to SQLite via `services/sqliteService.js` to persist task graphs and agent state across restarts.
9. Tests & verification — add unit tests for `toolRegistry` and `taskGraph` (simple node deps, success/failure flows) and an integration test that runs a small goal (e.g., "Write summary") through planner → executor → reflection loop.
10. Documentation & examples — add README snippets showing how to add a new tool manifest and runner, and an example planner prompt producing TaskNodes.

**Relevant files**
- renderer/lib/agentLoop.js — current loop to modify
- renderer/lib/webllm.js — current planner and LLM wrapper
- renderer/lib/webllmWorker.js — worker patterns to reference
- workers/*.js — worker handlers that can be wrapped as tool runners
- services/sqliteService.js — extend for `agent_tasks`/`agent_state`
- services/chromaService.js — tool runner for `knowledge_search`/`queryChroma`

**Verification**
1. Unit tests for `toolRegistry` (register/get/run mock tool) and `taskGraph` (deps resolution, status transitions).
2. Integration test: goal "Write summary". Planner must emit a task graph with `gather_sources` -> `verify_facts` -> `write_summary`. Executor completes tasks in order and returns a final `summary` result.
3. Manual test: run agent on a real short goal and confirm it persists task graph to SQLite and resumes after restart (if persistence enabled).

**Decisions / Assumptions**
- Use JSON Schema for tool and task validation.
- Keep tool runners as JS functions (no transpile needed). Runners can call existing worker IPC or service functions.
- Persisting task graph is optional; start in-memory and add SQLite persistence as an opt-in step.
- Planner LLM will be requested to output JSON; a fallback to legacy free-text parsing will be kept for robustness initially.

**Further Considerations**
1. Do you want task graphs persisted across restarts by default, or opt-in per-agent? Recommendation: opt-in via config flag.
2. Priority rules: should the agent support interrupts / user-inserted high-priority tasks? (Yes/No)
3. Confidence threshold: numeric (0-1) or qualitative labels? Recommendation: numeric 0.8 default.
