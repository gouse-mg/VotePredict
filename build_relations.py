"""
build_relations.py
------------------
Reads data.csv with columns:
    id, Name, Father, Mother, Gender

Only processes rows where Father, Mother AND Gender are ALL filled.
Skips/ignores rows missing any of those 3 fields.

Produces relations.csv with columns:
    id, Name, Father, Mother, Gender, Spouse, Siblings, StepSiblings

Definitions:
  - Spouse       : two people who appear together as Father+Mother of any child
  - Siblings     : share the SAME Father AND the SAME Mother
  - StepSiblings : share EXACTLY ONE parent (father OR mother, not both)

Lists are semicolon-separated ids, e.g. "3;5;7"
"""

import csv
from collections import defaultdict

INPUT_FILE  = "data.csv"
OUTPUT_FILE = "relations.csv"

# ── 1. Load — only keep rows where Father, Mother, Gender are all filled ──────
people = {}  # id -> dict

with open(INPUT_FILE, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid    = row["id"].strip()
        father = row["Father"].strip()
        mother = row["Mother"].strip()
        gender = row["Gender"].strip()

        # Skip if any of the three key fields is missing
        if not father or not mother or not gender:
            continue

        people[pid] = {
            "id":     pid,
            "Name":   row["Name"].strip(),
            "Father": father,
            "Mother": mother,
            "Gender": gender,
        }

print(f"Loaded {len(people)} complete entries (Father + Mother + Gender all filled).")

# ── 2. Spouses: Father+Mother of any common child are spouses ─────────────────
spouses = defaultdict(set)

for p in people.values():
    f, m = p["Father"], p["Mother"]
    spouses[f].add(m)
    spouses[m].add(f)

# ── 3. Siblings & Step-siblings ───────────────────────────────────────────────
siblings      = defaultdict(set)
step_siblings = defaultdict(set)

ids = list(people.keys())

for i in range(len(ids)):
    for j in range(i + 1, len(ids)):
        a, b = ids[i], ids[j]
        pa, pb = people[a], people[b]

        shared_father = pa["Father"] == pb["Father"]
        shared_mother = pa["Mother"] == pb["Mother"]

        if shared_father and shared_mother:
            siblings[a].add(b)
            siblings[b].add(a)
        elif shared_father or shared_mother:
            step_siblings[a].add(b)
            step_siblings[b].add(a)

# ── 4. Write output ───────────────────────────────────────────────────────────
def fmt(s):
    return ";".join(sorted(s)) if s else ""

fieldnames = ["id", "Name", "Father", "Mother", "Gender", "Spouse", "Siblings", "StepSiblings"]

with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for pid in sorted(people.keys(), key=lambda x: int(x) if x.isdigit() else x):
        p = people[pid]
        writer.writerow({
            "id":           pid,
            "Name":         p["Name"],
            "Father":       p["Father"],
            "Mother":       p["Mother"],
            "Gender":       p["Gender"],
            "Spouse":       fmt(spouses.get(pid, set())),
            "Siblings":     fmt(siblings[pid]),
            "StepSiblings": fmt(step_siblings[pid]),
        })

print(f"Done! Written to '{OUTPUT_FILE}'")