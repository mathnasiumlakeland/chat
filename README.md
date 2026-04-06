# Bonsai Browser Chat

Browser-local chat UI built with Bun, SvelteKit 2, and Svelte 5.

This app uses the llama.cpp WebUI as its visual baseline, but runs models in the browser instead of talking to a llama.cpp server. Conversations, selected model state, and chat history are stored locally in the browser with IndexedDB.

## Current Model Targets

- `prism-ml/Bonsai-1.7B-gguf`
- `prism-ml/Bonsai-4B-gguf`

The current runtime path is Prism-compatible GGUF via WASM. The codebase is structured so other runtimes can be added later behind the same interface.

## Tech Stack

- Bun
- SvelteKit 2
- Svelte 5
- Tailwind CSS v4
- Dexie for IndexedDB persistence
- `@wllama/wllama` patched with Prism-generated runtime assets

## Prerequisites

- [Bun](https://bun.sh/)
- A modern desktop browser with WebAssembly support

For local inference, the app also needs Prism-compatible runtime assets in `static/runtime/prism/`. If those files are already present, you do not need to rebuild them.

## Install

```sh
bun install
```

## Run The App

Start the development server:

```sh
bun run dev
```

Then open the local URL printed by Vite.

The home page automatically selects and preloads `prism-ml/Bonsai-1.7B-gguf` in the background.

## Build And Preview

Create a production build:

```sh
bun run build
```

Preview the built site locally:

```sh
bun run preview
```

Static output is written to `build/`.

## Checks And Tests

Run Svelte/type checks:

```sh
bun run check
```

Run unit tests:

```sh
bun run test
```

## Prism Runtime Assets

If browser inference assets are missing, rebuild them with:

```sh
bun run build:prism-runtime
```

This does two things:

1. Builds Prism-compatible `wllama` WASM artifacts into `static/runtime/prism/`
2. Patches `@wllama/wllama` so the app uses those generated worker/runtime files

There is also a patch-only command:

```sh
bun run patch:prism-runtime
```

### Notes

- `scripts/build-prism-runtime.sh` clones Prism's `llama.cpp` fork if needed.
- The build script expects Emscripten and CMake to be available.
- The defaults in the script assume Homebrew-style paths on macOS.
- If your local tools live elsewhere, override the environment variables used by the script, such as `EMSDK_PYTHON`, `CMAKE_BIN`, `PRISM_LLAMA_CPP_DIR`, or `WLLAMA_SOURCE_DIR`.

## Project Layout

- `src/routes/`: app routes
- `src/lib/components/app/`: copied/adapted llama.cpp WebUI app components
- `src/lib/components/ui/`: shared UI primitives
- `src/lib/stores/`: browser-local app state
- `src/lib/runtime/`: model runtime abstraction and GGUF WASM backend
- `src/lib/services/database.service.ts`: IndexedDB persistence
- `static/runtime/prism/`: generated Prism runtime assets
- `scripts/`: Prism runtime build and patch scripts

## Behavior Notes

- The app is browser-only and runs with `ssr = false`.
- Chat history is stored locally in the browser, not on a server.
- The current UI intentionally stays close to the vendored llama.cpp WebUI.
- MCP and remote llama.cpp server surfaces are present mostly as compatibility shims and are not the primary runtime path here.
