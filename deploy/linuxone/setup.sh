#!/usr/bin/env bash
# PrioriHealth setup for an IBM LinuxONE (s390x) VM.
#
#   bash deploy/linuxone/setup.sh
#
# Installs OS packages, builds llama.cpp, downloads the big-endian Granite model and
# creates the Python environment. Safe to re-run. Supports Ubuntu/Debian and RHEL-family.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPT="${PRIORIHEALTH_OPT:-$HOME/priorihealth-opt}"
MODEL_REPO="taronaeo/Granite-3.3-2B-Instruct-BE-GGUF"
MODEL_FILE="granite-3.3-2b-instruct-be.Q8_0.gguf"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

arch="$(uname -m)"
if [[ "$arch" != "s390x" ]]; then
  echo "Warning: this machine is $arch, not s390x (IBM LinuxONE). Continuing anyway." >&2
fi

# ---------------------------------------------------------------- OS packages
say "Installing OS packages"
if command -v apt-get >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y git cmake build-essential pkg-config libopenblas-dev curl \
    python3 python3-venv python3-dev python3-pip python3-numpy python3-pandas
  PY=python3
elif command -v dnf >/dev/null; then
  sudo dnf install -y git cmake gcc gcc-c++ make openblas-devel curl python3.12 python3.12-devel \
    || sudo dnf install -y git cmake gcc gcc-c++ make openblas-devel curl python3.11 python3.11-devel
  PY="$(command -v python3.12 || command -v python3.11)"
  # numpy/pandas RPMs for this Python, if the distro has them; otherwise pip builds them below.
  pyver="$($PY -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
  sudo dnf install -y "python${pyver}-numpy" "python${pyver}-pandas" 2>/dev/null \
    || echo "No numpy/pandas RPMs for Python ${pyver}; pip will compile them (slow, ~20-40 min)."
else
  echo "Unsupported distro: install git, cmake, a C/C++ compiler, OpenBLAS and Python 3.11+ manually." >&2
  exit 1
fi

"$PY" - <<'PY'
import sys
assert sys.version_info >= (3, 11), f"Python 3.11+ required, found {sys.version}"
PY

# ---------------------------------------------------------------- Python environment
say "Creating Python environment (.venv, using the OS numpy/pandas)"
cd "$ROOT"
"$PY" -m venv --system-site-packages .venv
.venv/bin/pip install --upgrade pip wheel setuptools
.venv/bin/pip install -r requirements-linuxone.txt
# Fallback when the OS did not provide them (RHEL without RPMs): compile from source.
.venv/bin/python -c "import numpy, pandas" 2>/dev/null || .venv/bin/pip install "numpy>=1.26" "pandas>=2.1,<2.4"
.venv/bin/python -c "import numpy, pandas, fastapi, pydantic; print('python deps OK')"

# ---------------------------------------------------------------- llama.cpp
say "Building llama.cpp (OpenBLAS + VXE vector acceleration)"
bash "$ROOT/deploy/linuxone/build_llamacpp.sh" "$OPT/llama.cpp"

# ---------------------------------------------------------------- model
say "Downloading big-endian Granite 3.3 2B ($MODEL_FILE, ~2.7 GB)"
mkdir -p "$OPT/models"
if [[ ! -s "$OPT/models/$MODEL_FILE" ]]; then
  curl -L --fail --retry 3 -o "$OPT/models/$MODEL_FILE.part" \
    "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE"
  mv "$OPT/models/$MODEL_FILE.part" "$OPT/models/$MODEL_FILE"
fi

# ---------------------------------------------------------------- config
say "Writing .env (engine = llama.cpp on this server)"
[[ -f .env ]] || cp .env.example .env
grep -q '^PRIORIHEALTH_PROVIDER=' .env || echo 'PRIORIHEALTH_PROVIDER=llamacpp' >> .env
grep -q '^LLAMACPP_HOST=' .env || echo 'LLAMACPP_HOST=http://127.0.0.1:8080' >> .env

# ---------------------------------------------------------------- data
say "Downloading the TriageAgent benchmark"
.venv/bin/python scripts/download_data.py >/dev/null && echo "benchmark OK"

cat <<EOF

Setup complete.
  llama.cpp : $OPT/llama.cpp/build/bin/llama-server
  model     : $OPT/models/$MODEL_FILE
Next: bash deploy/linuxone/install_services.sh   (starts the model server and the web app)
EOF
