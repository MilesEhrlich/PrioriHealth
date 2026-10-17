"""Shared visual tokens for charts (PNG) and the Streamlit app."""

from __future__ import annotations

import plotly.graph_objects as go
import plotly.io as pio

ACCENT = "#0F62FE"      # IBM blue: the persona debate / anything we want the eye on
INK = "#161616"         # primary text
MUTED = "#525252"       # secondary text
CONTEXT = "#8D8D8D"     # comparison conditions (deliberately colorless)
CONTEXT_LIGHT = "#C6C6C6"
GRID = "#E0E0E0"
SURFACE = "#FFFFFF"
PAGE = "#F7F8FA"
FONT = "IBM Plex Sans, Helvetica Neue, Arial, sans-serif"
MONO = "IBM Plex Mono, Menlo, monospace"

ESI_COLORS = {1: "#DA1E28", 2: "#FF832B", 3: "#F1C21B", 4: "#24A148", 5: "#0F62FE"}
ESI_TEXT = {1: "#FFFFFF", 2: "#161616", 3: "#161616", 4: "#FFFFFF", 5: "#FFFFFF"}

CONDITION_LABELS = {
    "A": "A · Single agent",
    "B": "B · Neutral panel",
    "C": "C · Trait panel (consensus)",
    "D": "D · Trait panel, no discussion",
}


def condition_color(cond: str) -> str:
    """Only the full system gets the accent; every baseline is context gray."""
    return ACCENT if cond == "C" else CONTEXT


TEMPLATE = go.layout.Template(
    layout=go.Layout(
        font=dict(family=FONT, size=15, color=INK),
        paper_bgcolor=SURFACE,
        plot_bgcolor=SURFACE,
        title=dict(font=dict(size=20, color=INK), x=0.01, xanchor="left", y=0.97,
                   xref="container"),
        margin=dict(l=24, r=48, t=96, b=64),
        xaxis=dict(gridcolor=GRID, linecolor=GRID, zeroline=False, ticks="", automargin=True,
                   tickfont=dict(color=MUTED), title_font=dict(color=MUTED, size=14)),
        yaxis=dict(gridcolor=GRID, linecolor=GRID, zeroline=False, ticks="", automargin=True,
                   ticklabelstandoff=8, title_standoff=16,
                   tickfont=dict(color=MUTED), title_font=dict(color=MUTED, size=14)),
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, xref="paper",
                    font=dict(color=MUTED, size=13)),
        hoverlabel=dict(font=dict(family=FONT, size=13), bgcolor=SURFACE, bordercolor=GRID),
        bargap=0.35,
    )
)
pio.templates["triage"] = TEMPLATE
