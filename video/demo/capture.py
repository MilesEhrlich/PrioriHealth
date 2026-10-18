"""Capture full-HD screenshots of the LOCAL site for the demo video, plus the boxes the cursor clicks.

    uv run --with playwright==1.48.0 python -I video/demo/capture.py [base_url]

Uses the installed Google Chrome. Writes video/public/demo/*.png and video/public/demo/shots.json.
Signs in as the shared demo account; confirming the nurse level changes LOCAL demo data only.
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
if not BASE.startswith(("http://localhost", "http://127.0.0.1")):
    sys.exit("Refusing to capture anything but a local server.")
OUT = Path(__file__).resolve().parent.parent / "public" / "demo"
OUT.mkdir(parents=True, exist_ok=True)
boxes: dict[str, dict] = {}


def box(name, locator):
    b = locator.bounding_box()
    boxes[name] = {"x": round(b["x"]), "y": round(b["y"]), "w": round(b["width"]), "h": round(b["height"])}


def shot(page, name):
    page.wait_for_timeout(700)
    page.screenshot(path=str(OUT / f"{name}.png"))


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = ctx.new_page()

    # 1. Landing page, signed out.
    page.goto(f"{BASE}/")
    page.wait_for_load_state("networkidle")
    shot(page, "landing")
    box("landing_demo", page.get_by_role("button", name="Try the demo").first)

    # 2. Demo sign-in -> dashboard.
    page.get_by_role("button", name="Try the demo").first.click()
    page.wait_for_url("**/app")
    page.wait_for_timeout(2500)
    shot(page, "dashboard")
    box("dashboard_open", page.get_by_role("link", name="Open waiting room"))

    # 3. Waiting room.
    page.goto(f"{BASE}/app/waiting")
    page.wait_for_timeout(2500)
    shot(page, "waiting")
    snap = page.evaluate("fetch('/api/waitlist').then(r => r.json())")
    waiting = snap["waiting"]
    target = next((r for r in waiting if r["escalated"] and r["nurse_esi"] is None), waiting[0])
    row = page.locator("tbody tr", has_text=target["label"]).first
    box("waiting_review", row.get_by_role("button", name="Review"))
    box("waiting_list", page.locator("table").last)
    other = next((r for r in waiting if r["id"] != target["id"]), target)

    # 4. Review drawer for that patient.
    page.goto(f"{BASE}/app/waiting?review={target['id']}")
    page.wait_for_timeout(2500)
    shot(page, "review")
    drawer = page.get_by_role("dialog").first if page.get_by_role("dialog").count() else page
    rows = page.locator("tr[aria-selected]")
    member = rows.nth(min(3, rows.count() - 1))
    box("review_member", member)
    member.click()
    page.wait_for_timeout(900)
    shot(page, "review_member")

    # 5. Nurse decision: scroll to it, confirm the panel's (or safety) level.
    level = target.get("effective_esi") or target.get("esi") or 2
    confirm = page.get_by_role("button", name=f"Confirm ESI {level}")
    confirm.scroll_into_view_if_needed()
    page.wait_for_timeout(600)
    shot(page, "nurse")
    box("nurse_confirm", confirm)
    confirm.click()
    page.wait_for_timeout(1500)
    shot(page, "nurse_done")

    # 6. Printable QR sign.
    page.goto(f"{BASE}/app/waiting/sign")
    page.wait_for_timeout(1500)
    shot(page, "sign")

    # 7. Case review and evaluation results (benchmark).
    page.goto(f"{BASE}/app/case")
    page.wait_for_timeout(3000)
    shot(page, "case")
    page.goto(f"{BASE}/app/results")
    page.wait_for_timeout(3500)
    shot(page, "results")

    # 8. Patient phone pages (signed out context, phone size, retina).
    phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pp = phone.new_page()
    pp.goto(f"{BASE}/status")
    pp.wait_for_timeout(1200)
    pp.locator("#code").fill(other["code"])
    pp.wait_for_timeout(300)
    pp.screenshot(path=str(OUT / "phone_lookup.png"))
    pp.goto(f"{BASE}/status/{other['code']}")
    pp.wait_for_timeout(2500)
    pp.screenshot(path=str(OUT / "phone_status.png"))

    (OUT / "shots.json").write_text(json.dumps({"boxes": boxes, "target": target["label"], "code": other["code"]}, indent=2))
    browser.close()
print(json.dumps(boxes, indent=1))
