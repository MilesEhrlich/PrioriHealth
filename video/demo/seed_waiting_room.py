"""Fill the LOCAL demo waiting room (Riverbend) with fictional arrivals, a few seconds apart.

    python3 video/demo/seed_waiting_room.py [base_url] [interval_s]

Signs in as the shared demo account, clears Riverbend's local waiting room, then adds each
arrival from arrivals.json. The local panel (free engine) triages them in the background.
"""
import http.cookiejar
import json
import sys
import time
import urllib.request
from pathlib import Path

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
interval = float(sys.argv[2]) if len(sys.argv) > 2 else 45
if not base.startswith(("http://localhost", "http://127.0.0.1")):
    sys.exit("Refusing to seed anything but a local server.")
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"} if body else {})
    with opener.open(req) as r:
        return json.loads(r.read() or "{}")


call("POST", "/api/auth/demo")
call("DELETE", "/api/waitlist")
arrivals = json.loads((Path(__file__).parent / "arrivals.json").read_text())
for i, (label, vignette) in enumerate(arrivals):
    if i:
        time.sleep(interval)
    e = call("POST", "/api/waitlist", {"vignette": vignette, "label": label})
    print(time.strftime("%H:%M:%S"), label, e["code"], e["chief_complaint"], flush=True)
print("all arrivals added")
