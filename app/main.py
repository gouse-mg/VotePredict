"""
VotePredict — FastAPI Graph Server
Parses relations.csv and exposes the graph data as JSON.
Frontend only handles rendering via D3.js.
"""

import csv
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ── Paths ─────────────────────────────────────────────────────
BASE_DIR  = Path(__file__).parent          # app/
ROOT_DIR  = BASE_DIR.parent               # project root
CSV_PATH  = ROOT_DIR / "relations.csv"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="VotePredict Graph API", version="1.0.0")

# ── Mount static files (CSS / JS) ────────────────────────────
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ══════════════════════════════════════════════════════════════
# Helper — CSV parser
# ══════════════════════════════════════════════════════════════
def parse_ids(raw: str) -> list[str]:
    """Split a semicolon-delimited cell into a clean list of IDs."""
    if not raw or not raw.strip():
        return []
    return [s.strip() for s in raw.strip().split(";") if s.strip()]


def load_csv() -> list[dict]:
    """Read relations.csv and return a list of row dicts."""
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"relations.csv not found at {CSV_PATH}")
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [row for row in reader if row.get("id", "").strip()]


# ══════════════════════════════════════════════════════════════
# Core — Build graph (nodes + edges)
# ══════════════════════════════════════════════════════════════
def build_graph(rows: list[dict]) -> dict:
    """
    From parsed CSV rows, produce:
      nodes: [{id, name, gender, father_id, mother_id, spouse_ids,
               sibling_ids, step_sib_ids}]
      edges: [{source, target, type}]
    """
    node_map: dict[str, dict] = {}

    for row in rows:
        nid = row["id"].strip()
        node_map[nid] = {
            "id":           nid,
            "name":         row.get("Name", f"Person {nid}").strip(),
            "gender":       row.get("Gender", "M").strip(),
            "father_id":    row.get("Father", "").strip(),
            "mother_id":    row.get("Mother", "").strip(),
            "spouse_ids":   parse_ids(row.get("Spouse", "")),
            "sibling_ids":  parse_ids(row.get("Siblings", "")),
            "step_sib_ids": parse_ids(row.get("StepSiblings", "")),
        }

    nodes = list(node_map.values())

    edges: list[dict] = []
    seen: set[str] = set()

    def add_edge(src: str, tgt: str, edge_type: str) -> None:
        if src not in node_map or tgt not in node_map:
            return
        # Deduplicate undirected edges (except parent-child which is directed)
        if edge_type == "parent-child":
            key = f"pc_{src}_{tgt}"
        else:
            a, b = min(src, tgt, key=int), max(src, tgt, key=int)
            key = f"{edge_type}_{a}_{b}"
        if key in seen:
            return
        seen.add(key)
        edges.append({"source": src, "target": tgt, "type": edge_type})

    for n in nodes:
        if n["father_id"]:
            add_edge(n["father_id"], n["id"], "parent-child")
        if n["mother_id"]:
            add_edge(n["mother_id"], n["id"], "parent-child")
        for s in n["spouse_ids"]:
            add_edge(n["id"], s, "spouse")
        for s in n["sibling_ids"]:
            add_edge(n["id"], s, "sibling")
        for s in n["step_sib_ids"]:
            add_edge(n["id"], s, "step-sibling")

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "total_persons":    len(nodes),
            "total_relations":  len(edges),
            "parent_child":     sum(1 for e in edges if e["type"] == "parent-child"),
            "spouse":           sum(1 for e in edges if e["type"] == "spouse"),
            "sibling":          sum(1 for e in edges if e["type"] == "sibling"),
            "step_sibling":     sum(1 for e in edges if e["type"] == "step-sibling"),
        },
    }


# ══════════════════════════════════════════════════════════════
# Routes
# ══════════════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    """Serve the dashboard HTML page."""
    html_path = STATIC_DIR / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found in static/")
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


@app.get("/api/graph")
async def get_graph():
    """
    Parse relations.csv and return the full graph as JSON.
    JS frontend calls this endpoint when the user clicks 'Generate Graph'.
    """
    try:
        rows  = load_csv()
        graph = build_graph(rows)
        return JSONResponse(content=graph)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building graph: {e}")


@app.get("/api/person/{person_id}")
async def get_person(person_id: str):
    """Return full details for a single person by ID."""
    try:
        rows = load_csv()
        match = next((r for r in rows if r.get("id", "").strip() == person_id), None)
        if not match:
            raise HTTPException(status_code=404, detail=f"Person {person_id} not found")
        return JSONResponse(content={
            "id":           match["id"].strip(),
            "name":         match.get("Name", "").strip(),
            "gender":       match.get("Gender", "M").strip(),
            "father_id":    match.get("Father", "").strip(),
            "mother_id":    match.get("Mother", "").strip(),
            "spouse_ids":   parse_ids(match.get("Spouse", "")),
            "sibling_ids":  parse_ids(match.get("Siblings", "")),
            "step_sib_ids": parse_ids(match.get("StepSiblings", "")),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
