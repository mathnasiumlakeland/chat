#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
Q1_SMOKE_DIR="${Q1_SMOKE_DIR:-$ROOT_DIR/../bonsai_webgpu_q1/q1-webgpu-smoke}"
SOURCE_WLLAMA_DIR="${SOURCE_WLLAMA_DIR:-$ROOT_DIR/node_modules/@wllama/wllama}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/static/runtime/prism}"
RUNTIME_PRESET="${RUNTIME_PRESET:-perf}"
SKIP_SOURCE_REFRESH="${SKIP_SOURCE_REFRESH:-1}"

if [[ ! -d "$Q1_SMOKE_DIR" ]]; then
	echo "Missing Q1 WebGPU smoke repo at $Q1_SMOKE_DIR" >&2
	exit 1
fi

if [[ ! -d "$SOURCE_WLLAMA_DIR" ]]; then
	echo "Missing @wllama/wllama sources at $SOURCE_WLLAMA_DIR" >&2
	exit 1
fi

mkdir -p "$OUTPUT_ROOT/single-thread"

(
	cd "$Q1_SMOKE_DIR"
	SOURCE_WLLAMA_DIR="$SOURCE_WLLAMA_DIR" \
	RUNTIME_PRESET="$RUNTIME_PRESET" \
	PATCH_VENDOR_BUNDLE=0 \
	SKIP_SOURCE_REFRESH="$SKIP_SOURCE_REFRESH" \
	./scripts/prepare-runtime.sh
)

cp "$Q1_SMOKE_DIR/runtime/single-thread/wllama.js" "$OUTPUT_ROOT/single-thread/wllama.js"
cp "$Q1_SMOKE_DIR/runtime/single-thread/wllama.wasm" "$OUTPUT_ROOT/single-thread/wllama.wasm"
cp "$Q1_SMOKE_DIR/runtime/single-thread/runtime-manifest.json" \
	"$OUTPUT_ROOT/single-thread/runtime-manifest.json"

echo "Raw Q1 WebGPU runtime assets written to $OUTPUT_ROOT"
