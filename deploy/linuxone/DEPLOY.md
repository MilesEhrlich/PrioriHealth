# Deploying PrioriHealth on IBM LinuxONE

Everything runs on one LinuxONE Community Cloud virtual server:

| Component | What runs | Where |
|---|---|---|
| Granite model server | llama.cpp `llama-server`, Granite 3.3 2B (big-endian Q8_0) | `127.0.0.1:8080` (private) |
| Web app | FastAPI + the built React interface | `0.0.0.0:8000` (public) |
| Experiments | `scripts/run_experiments.py --provider llamacpp` | run over SSH |

LinuxONE is IBM Z hardware (`s390x`, big-endian). That is why the setup differs from a laptop:
- Ollama has no s390x build, so llama.cpp serves the model.
- llama.cpp on s390x needs **big-endian** model files.
- numpy/pandas have no s390x wheels on PyPI, so they come from the OS package manager.
- The web interface is shipped prebuilt (`web/dist`), so no Node.js is needed.

## 1. Get a server
1. Sign up for the **IBM LinuxONE Community Cloud** and create a virtual server.
   - Choose **Ubuntu 24.04** if offered (RHEL 9 also works). Pick the **largest size** available; the model needs about 3 GB of RAM.
   - Add your SSH public key (`cat ~/.ssh/id_ed25519.pub` on your Mac).
2. Note the server's public IP. In the Community Cloud console, allow inbound **TCP 8000** (and 22 for SSH) if there is a security group or firewall setting.

## 2. Install (about 20–30 minutes, mostly compiling llama.cpp)
```bash
ssh <user>@<server-ip>
uname -m                                   # should print s390x
git clone <your-repo-url> priorihealth && cd priorihealth
bash deploy/linuxone/setup.sh              # OS packages, Python env, llama.cpp, model, data
bash deploy/linuxone/install_services.sh   # starts model server + web app as services
```
Then open `http://<server-ip>:8000`. The header shows **IBM LINUXONE**, and Home → System status shows `IBM LinuxONE · s390x`.

If the pre-converted model download fails, run `bash scripts/convert_granite_be.sh` on your Mac and copy the file over with `scp`. It goes in `~/priorihealth-opt/models/` on the server.

## 3. Check it works
```bash
curl -s localhost:8080/health                                        # model server
.venv/bin/python scripts/smoke_llm.py --provider llamacpp            # one structured Granite call
.venv/bin/python -m pytest -q                                        # unit tests on s390x
curl -s localhost:8000/api/system                                    # "is_linuxone": true
```
In the app: **Case Review → Triage new case**. "Granite on this server (llama.cpp)" is selected by default.

## 4. Run the experiments on LinuxONE
CPU inference on a small shared VM is slow (tens of seconds per call). Runs are cached and resumable, so start them in the background:
```bash
nohup .venv/bin/python scripts/run_experiments.py --provider llamacpp > run.log 2>&1 &
tail -f run.log
```
The 20-patient sample (all four configurations plus the fairness check) takes a few hours; add `--full` for all 75 patients overnight. Results land in `results/llamacpp/sample/`, and the app's model switcher shows them as **Granite 3.3 2B · LinuxONE** automatically.

Slide PNGs need Chrome, which isn't available on s390x. Make them on the Mac: copy `results/llamacpp/` back, then run `uv run --extra charts python scripts/make_charts.py`.

## 5. Operate
```bash
sudo systemctl status priorihealth-llama priorihealth-web
sudo journalctl -u priorihealth-web -f          # web logs
sudo systemctl restart priorihealth-web         # after git pull
```
After pulling new code: `git pull && sudo systemctl restart priorihealth-web`.

## Credits
llama.cpp on LinuxONE is free. watsonx.ai stays available in the app but is **locked** by `llm.monthly_token_budget.watsonx` in `config.yaml`. Raise it only on purpose. To use watsonx from the server, copy the three `WATSONX_*` values into `.env` on the VM.

## Notes for judges / write-up
- Hardware acceleration: llama.cpp uses the IBM Z vector facility (VXE/VXE2, z15 and newer) with OpenBLAS. On z17 / LinuxONE 5, llama.cpp can also target the on-chip AI accelerator (zDNN, `-DGGML_ZDNN=ON`); Community Cloud machines may not expose it.
- The response cache keys llama.cpp answers by CPU architecture. Results labelled LinuxONE were computed on `s390x`, never replayed from a laptop.
