#!/usr/bin/env bash
# Build llama.cpp with IBM zDNN so Granite runs on the IBM z17 / LinuxONE 5 on-chip AI
# accelerator (Telum II NNPA). Measured on a 3-vCPU z17 VM: prompt processing ~105 tok/s
# vs ~21 tok/s CPU-only (about 5x), same answers. Requires NNPA (z17+); see build-s390x.md.
#
#   bash deploy/linuxone/build_zdnn.sh
set -euo pipefail
OPT="${PRIORIHEALTH_OPT:-$HOME/priorihealth-opt}"
LL="$OPT/llama.cpp"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

if ! grep -qw nnpa /proc/cpuinfo; then
  echo "This CPU has no NNPA (needs IBM z17 / LinuxONE 5). Keeping the CPU build." >&2
  exit 1
fi
sudo -E apt-get install -y autoconf automake libtool make gcc g++ git ninja-build >/dev/null

# Ubuntu 24.04 ships libzdnn 1.0.1; llama.cpp needs a newer one, so build IBM zDNN from source.
if [[ ! -f "$OPT/zdnn-libs/lib/libzdnn.so" ]]; then
  [[ -d "$OPT/zDNN/.git" ]] || git clone --recurse-submodules https://github.com/IBM/zDNN.git "$OPT/zDNN"
  (cd "$OPT/zDNN" && autoreconf . && ./configure --prefix="$OPT/zdnn-libs" && make build -j"$(nproc)" && make install)
fi

[[ -d "$LL/.git" ]] || bash "$(dirname "$0")/build_llamacpp.sh" "$LL"
cmake -S "$LL" -B "$LL/build-zdnn" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DGGML_ZDNN=ON -DZDNN_ROOT="$OPT/zdnn-libs" \
  -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_NATIVE=OFF -DGGML_VXE=ON \
  "-DCMAKE_C_FLAGS=-march=z16 -mtune=z16" "-DCMAKE_CXX_FLAGS=-march=z16 -mtune=z16" \
  -DLLAMA_CURL=OFF -DLLAMA_BUILD_WEBUI=OFF
cmake --build "$LL/build-zdnn" --config Release -j"$(nproc)" --target llama-server
LD_LIBRARY_PATH="$OPT/zdnn-libs/lib" "$LL/build-zdnn/bin/llama-server" --list-devices
