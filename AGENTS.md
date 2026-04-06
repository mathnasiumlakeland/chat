# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

- Stack: Bun, SvelteKit 2, Svelte 5, Tailwind CSS v4
- Output: static site via `@sveltejs/adapter-static`
- Runtime model execution: browser-only Prism raw Asyncify Q1 WebGPU runtime loaded through the local `gguf-wasm` backend
- Persistence: IndexedDB via Dexie
- UI base: copied/adapted from `../llama.cpp/tools/server/webui`
- Rendering mode: SPA-style browser app with `ssr = false`

## Non-Negotiable Product Rules

- Preserve the llama.cpp WebUI look and structure as closely as possible.
- Prefer copying/reusing vendored llama.cpp WebUI files over redesigning components.
- Keep the app browser-local. Do not introduce a required backend/server flow for chat.
- Default the home route to `prism-ml/Bonsai-1.7B-gguf` without a startup gate.
- Keep chat history, active conversation state, and selected model state persisted in the browser.
- Keep runtime integration behind the existing backend abstraction so future ONNX/WebGPU runtimes can plug in without rewriting the UI.

## Important Paths

- `src/routes/+layout.ts`: disables SSR for the whole app
- `src/routes/+layout.svelte`: main app shell using the vendored llama.cpp sidebar/layout
- `src/routes/+page.svelte`: home route
- `src/routes/chat/[id]/+page.svelte`: conversation restore route
- `src/lib/components/app/*`: primary copied llama.cpp WebUI component tree
- `src/lib/components/ui/*`: shared UI primitives used by the copied WebUI
- `src/lib/components/app/models/LaunchModelOverlay.svelte`: mandatory Bonsai model picker overlay
- `src/lib/stores/chat.svelte.ts`: browser-local chat orchestration and generation flow
- `src/lib/stores/conversations.svelte.ts`: IndexedDB-backed conversation/message state
- `src/lib/stores/models.svelte.ts`: model catalog/router-style compatibility store
- `src/lib/stores/model-state.svelte.ts`: selected model + load-state persistence
- `src/lib/stores/server.svelte.ts`: synthetic browser-local server compatibility store
- `src/lib/runtime/gguf-wasm-backend.ts`: active browser runtime backend that loads the validated raw Q1 WebGPU path
- `src/lib/runtime/prism-raw-q1-module.ts`: low-level raw runtime bridge used by the `gguf-wasm` backend
- `src/lib/runtime/prism-assets.ts`: validated runtime asset manifest/verification helper
- `src/lib/runtime/create-inference-backend.ts`: backend abstraction entrypoint
- `src/lib/services/database.service.ts`: Dexie schema and persistence helpers
- `src/styles/katex-custom.scss`: copied KaTeX styling expected by the vendored markdown renderer
- `scripts/build-prism-runtime.sh`: syncs the validated raw Q1 runtime assets from the sibling smoke repo
- `scripts/patch-prism-wllama.mjs`: patches runtime artifacts for app use

## UI Source Of Truth

- The visual baseline is the vendored llama.cpp WebUI in `../llama.cpp/tools/server/webui`.
- When changing chat UI, sidebar UI, dialogs, model selectors, markdown rendering, or layout:
  - inspect the vendored source first
  - copy or minimally adapt upstream code
  - avoid bespoke redesigns unless explicitly requested
- If a local file diverges from upstream only because of routing/runtime differences, keep the diff as small as possible.

## Browser Runtime Constraints

- This app is intentionally browser-only.
- Do not add server-only APIs, SvelteKit `load` dependencies that require SSR, or backend model calls unless explicitly requested.
- Model execution should continue to flow through the local runtime abstraction:
  - `gguf-wasm` is the active implementation and currently targets the raw Asyncify Q1 WebGPU runtime
  - other runtime kinds may exist in types/interfaces before they are implemented
- The validated Q1 baseline currently wired into the app is:
  - runtime preset `perf`
  - dispatch mode `static-throughput`
  - submit batch size `64`
  - param buffer count `128`
  - param upload mode `queue-write-buffer`
  - load config `n_ctx=4096`, `n_batch=256`, `n_threads=1`, `n_gpu_layers=999`, `offload_kqv=true`
- The experimental non-vector Q1 prefill path is not the default app configuration unless explicitly changed.
- Cross-origin isolation headers in `vite.config.ts` are important for WASM threading behavior. Preserve them unless the runtime strategy changes knowingly.

## Runtime Source Of Truth

- Runtime configuration decisions should follow `../bonsai_webgpu_q1/q1-webgpu-smoke/Q1_WEBGPU_STATUS.md`.
- The checked-in runtime assets under `static/runtime/prism/single-thread/` are expected to match the validated manifest enforced by `src/lib/runtime/prism-assets.ts`.
- If you intentionally change runtime tuning, update both the synced assets and the manifest verification logic together.

## Model Defaults

- The home route should default to `prism-ml/Bonsai-1.7B-gguf` and preload it in the background.
- Current catalog entries remain:
  - `prism-ml/Bonsai-1.7B-gguf`
  - `prism-ml/Bonsai-4B-gguf`
- Both current GGUF entries are configured for a `4096` token context in the app.
- Model selection may still be changed from the copied llama.cpp model selector UI after startup.

## Local Persistence Rules

- Conversations/messages live in IndexedDB and should remain browser-restorable across refreshes.
- Keep conversation records tied to model/runtime metadata.
- Avoid migrations or schema resets unless necessary and understood.
- If changing Dexie schema or conversation shape, add or update tests.

## Vendored WebUI Compatibility Notes

- Some llama.cpp WebUI stores/services are intentionally local compatibility shims in this repo.
- MCP and server integration surfaces are mostly stubs/no-ops here because this app is browser-local.
- Preserve those shims unless the feature is being implemented for real.
- The copied markdown renderer expects:
  - `$styles` alias from `svelte.config.js`
  - `katex-fonts` alias from `vite.config.ts`

## Tooling Notes

- `esbuild` is pinned to `0.28.0` in this repo because earlier installed binaries on this machine were hanging even on `--version`.
- If build/test suddenly stall again, verify the installed `esbuild` binary before assuming the app code is at fault.
- `bun run build:prism-runtime` depends on the sibling repo at `../bonsai_webgpu_q1/q1-webgpu-smoke`.
- That runtime sync script may finish writing assets before the external Emscripten link process fully exits. Verify the output files and manifest before assuming the sync failed.

## Local Commands

- Install deps: `bun install`
- Dev server: `bun run dev`
- Type/Svelte checks: `bun run check`
- Unit tests: `bun run test`
- Production build: `bun run build`
- Preview production build: `bun run preview`
- Rebuild Prism runtime assets: `bun run build:prism-runtime`
- Patch existing Prism runtime assets: `bun run patch:prism-runtime`

## Agent Workflow

- Prefer small, targeted edits over broad refactors.
- Do not edit generated output:
  - `build/`
  - `.svelte-kit/`
  - `node_modules/`
- For `.svelte` file edits:
  - run the Svelte autofixer
  - then run `bun run check`
- For runtime, store, or persistence changes:
  - run `bun run test`
  - run `bun run build`
- For raw runtime tuning or asset changes:
  - run `bun run build:prism-runtime` when needed to resync `static/runtime/prism/single-thread/`
  - confirm the manifest matches the expected Q1 baseline
- For UI changes that affect layout or interaction:
  - run a real browser smoke check after build/preview when practical

## Validation Defaults

- Minimum validation after meaningful changes:
  - `bun run check`
- For substantial changes:
  - `bun run test`
  - `bun run build`
- For shipped UI/runtime changes, prefer a browser smoke pass that verifies:
  - the llama.cpp shell renders
  - the default `1.7B` model is selected/preloading on the home route
  - an existing conversation can be restored
