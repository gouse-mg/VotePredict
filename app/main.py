"""
VotePredict — FastAPI Graph Server
Parses relations.csv and exposes the graph data as JSON.
Frontend only handles rendering via D3.js.
"""

import csv
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

# ── Cache CSV rows at startup (read once, reuse on all requests) ──
_CSV_CACHE: list[dict] | None = None

@app.on_event("startup")
def preload_csv() -> None:
    global _CSV_CACHE
    _CSV_CACHE = load_csv()
    print(f"[startup] Loaded {len(_CSV_CACHE)} rows from relations.csv")


# ══════════════════════════════════════════════════════════════
# Helper — CSV parser
# ══════════════════════════════════════════════════════════════
def parse_ids(raw: str) -> list[str]:
    """Split a semicolon-delimited cell into a clean list of IDs."""
    if not raw or not raw.strip():
        return []
    return [s.strip() for s in raw.strip().split(";") if s.strip()]


def load_csv() -> list[dict]:
    """Read relations.csv from disk (called once at startup)."""
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"relations.csv not found at {CSV_PATH}")
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [row for row in reader if row.get("id", "").strip()]


def get_rows() -> list[dict]:
    """Return cached CSV rows. Falls back to disk if cache is empty."""
    if _CSV_CACHE is not None:
        return _CSV_CACHE
    return load_csv()


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
# Core — Person subgraph
# ══════════════════════════════════════════════════════════════
def build_person_subgraph(rows: list[dict], person_id: str) -> dict:
    """
    Build a focused subgraph for a single person.
    Includes the target person + ALL direct relations:
      - Father, Mother
      - Spouses
      - Siblings, Step-siblings
      - Children (anyone whose Father or Mother == person_id)

    Returns same shape as build_graph: {nodes, edges, stats, focus_id}
    """
    # Build full node map first
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
            "relation":     None,  # filled below for direct neighbours
        }

    if person_id not in node_map:
        raise ValueError(f"Person ID '{person_id}' not found in relations.csv")

    focus = node_map[person_id]

    # ── Collect all neighbour IDs and their relation labels ──
    neighbours: dict[str, str] = {}  # id → relation label

    if focus["father_id"] and focus["father_id"] in node_map:
        neighbours[focus["father_id"]] = "Father"
    if focus["mother_id"] and focus["mother_id"] in node_map:
        neighbours[focus["mother_id"]] = "Mother"
    for s in focus["spouse_ids"]:
        if s in node_map:
            neighbours[s] = "Spouse"
    for s in focus["sibling_ids"]:
        if s in node_map:
            neighbours[s] = "Sibling"
    for s in focus["step_sib_ids"]:
        if s in node_map:
            neighbours[s] = "Step-Sibling"

    # Children: anyone in the dataset whose father_id or mother_id == person_id
    for nid, n in node_map.items():
        if nid == person_id:
            continue
        if n["father_id"] == person_id or n["mother_id"] == person_id:
            neighbours[nid] = "Child"

    # ── Build subgraph node list ──────────────────────────────
    focus_node = dict(node_map[person_id])
    focus_node["relation"] = "focus"

    sub_nodes = [focus_node]
    included_ids = {person_id}

    for nid, rel_label in neighbours.items():
        n = dict(node_map[nid])
        n["relation"] = rel_label
        sub_nodes.append(n)
        included_ids.add(nid)

    # ── Build edges (only between included nodes) ─────────────
    sub_edges: list[dict] = []
    seen: set[str] = set()

    def add_edge(src: str, tgt: str, edge_type: str) -> None:
        if src not in included_ids or tgt not in included_ids:
            return
        if edge_type == "parent-child":
            key = f"pc_{src}_{tgt}"
        else:
            a, b = min(src, tgt, key=int), max(src, tgt, key=int)
            key = f"{edge_type}_{a}_{b}"
        if key in seen:
            return
        seen.add(key)
        sub_edges.append({"source": src, "target": tgt, "type": edge_type})

    for n in sub_nodes:
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
        "focus_id": person_id,
        "focus_name": focus["name"],
        "nodes": sub_nodes,
        "edges": sub_edges,
        "stats": {
            "total_persons":   len(sub_nodes),
            "total_relations": len(sub_edges),
            "parent_child":    sum(1 for e in sub_edges if e["type"] == "parent-child"),
            "spouse":          sum(1 for e in sub_edges if e["type"] == "spouse"),
            "sibling":         sum(1 for e in sub_edges if e["type"] == "sibling"),
            "step_sibling":    sum(1 for e in sub_edges if e["type"] == "step-sibling"),
            "children":        sum(1 for n in sub_nodes if n["relation"] == "Child"),
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
        rows  = get_rows()
        graph = build_graph(rows)
        return JSONResponse(content=graph)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building graph: {e}")


@app.get("/api/graph/person/{person_id}")
async def get_person_subgraph(person_id: str):
    """
    Return a focused subgraph for a specific person.
    Includes the person + their direct relations:
    father, mother, spouses, siblings, step-siblings, children.
    """
    try:
        rows = get_rows()
        subgraph = build_person_subgraph(rows, person_id.strip())
        return JSONResponse(content=subgraph)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building subgraph: {e}")


@app.get("/api/person/{person_id}")
async def get_person(person_id: str):
    """Return full details for a single person by ID."""
    try:
        rows = get_rows()
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
