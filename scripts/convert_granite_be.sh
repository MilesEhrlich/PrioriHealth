#!/usr/bin/env bash
# FALLBACK ONLY. setup.sh downloads a pre-converted big-endian Granite model; use this
# script if that download is unavailable. Run it on a Mac/PC (conversion needs PyTorch,
# which has no s390x build), then copy the output file to the LinuxONE server.
#
#   bash scripts/convert_granite_be.sh            # -> granite-3.3-2b-instruct-be.Q8_0.gguf
#   scp granite-3.3-2b-instruct-be.Q8_0.gguf <user>@<vm>:~/priorihealth-opt/models/
set -euo pipefail

WORK="${WORK:-$PWD/.convert}"
HF_MODEL="ibm-granite/granite-3.3-2b-instruct"
OUT="granite-3.3-2b-instruct-be.Q8_0.gguf"

mkdir -p "$WORK"
[[ -d "$WORK/llama.cpp" ]] || git clone --depth 1 --branch v0.7.0 https://github.com/ggml-org/llama.cpp "$WORK/llama.cpp"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q -r "$WORK/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt" "huggingface_hub[cli]"
"$WORK/venv/bin/huggingface-cli" download "$HF_MODEL" --local-dir "$WORK/granite-3.3-2b-instruct"

# --bigendian writes the byte order IBM Z expects; q8_0 keeps quality close to f16 at ~2.7 GB.
"$WORK/venv/bin/python" "$WORK/llama.cpp/convert_hf_to_gguf.py" \
  --bigendian --outtype q8_0 --outfile "$OUT" "$WORK/granite-3.3-2b-instruct"

ls -lh "$OUT"
echo "Copy $OUT to ~/priorihealth-opt/models/ on the LinuxONE server."
