#!/usr/bin/env bash
# Build llama.cpp for IBM Z / LinuxONE (s390x) following upstream docs/build-s390x.md:
# OpenBLAS + VXE/VXE2 SIMD (on by default; needs z15 / LinuxONE III or newer).
#
#   bash deploy/linuxone/build_llamacpp.sh [install_dir]
set -euo pipefail

DIR="${1:-$HOME/priorihealth-opt/llama.cpp}"
TAG="${LLAMACPP_TAG:-v0.7.0}"   # same release we test on the Mac; override with LLAMACPP_TAG=...

if [[ ! -d "$DIR/.git" ]]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$DIR" \
    || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$DIR"   # tag missing: use latest
fi

cmake -S "$DIR" -B "$DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS \
  -DLLAMA_CURL=OFF
cmake --build "$DIR/build" --config Release -j "$(nproc)" --target llama-server llama-cli

"$DIR/build/bin/llama-server" --version
