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

# On z17 (machine type 9175) llama.cpp's native build asks for -march=arch15, which needs
# GCC 15+. Ubuntu 24.04 ships GCC 13, so fall back to z16 (arch14): still VXE/VXE2 SIMD.
ARCH_FLAGS=()
if ! echo 'int main(){return 0;}' | cc -march=native -x c - -o /dev/null 2>/dev/null \
   || ! echo 'int main(){return 0;}' | cc -march=arch15 -x c - -o /dev/null 2>/dev/null; then
  if grep -q "machine = 9175\|machine = 9176" /proc/cpuinfo 2>/dev/null || ! cc -march=arch15 -x c /dev/null -E >/dev/null 2>&1; then
    echo "Compiler lacks z17 (arch15) support; building for z16 (arch14)."
    # GGML_NATIVE=OFF also disables the vector backend, so turn VXE back on explicitly.
    ARCH_FLAGS=(-DGGML_NATIVE=OFF -DGGML_VXE=ON "-DCMAKE_C_FLAGS=-march=z16 -mtune=z16" "-DCMAKE_CXX_FLAGS=-march=z16 -mtune=z16")
  fi
fi

rm -rf "$DIR/build"
cmake -S "$DIR" -B "$DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS \
  -DLLAMA_CURL=OFF -DLLAMA_BUILD_WEBUI=OFF \
  "${ARCH_FLAGS[@]}"
cmake --build "$DIR/build" --config Release -j "$(nproc)" --target llama-server llama-cli

"$DIR/build/bin/llama-server" --version
