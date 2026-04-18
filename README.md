# Bonsai Browser Chat

Browser-local Bonsai chat app built with Bun, SvelteKit 2, and Svelte 5.

The UI stays close to the llama.cpp WebUI, but inference runs in the browser with WebGPU instead of through a local server. Conversations, selected model state, and chat history are persisted in IndexedDB.

## Current Setup

- Static SvelteKit app with `ssr = false`
- ONNX/WebGPU inference via Transformers.js
- Default model: `onnx-community/Ternary-Bonsai-1.7B-ONNX`
- Additional models: `onnx-community/Ternary-Bonsai-4B-ONNX`, `onnx-community/Ternary-Bonsai-8B-ONNX`
- Production output: `build/`

## Getting Started

```sh
bun install
bun run dev
```

Open the local Vite URL in a desktop browser with WebGPU support.
