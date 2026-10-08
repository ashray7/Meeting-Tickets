"""Assignee matching: maps model output names to team members.

Rules:
1. Clean: strip whitespace, leading '@', trailing punctuation; lowercase.
2. Key folding: v/w -> b, ee -> i, oo -> u, ph -> f, z -> j, collapse repeated letters.
3. Matching: key equality on full or first name; fallback to difflib (>=0.85, >=4 chars).
4. Ambiguity: ties between different members return unmatched (never guess).
"""

import difflib, re, string

def clean_name(name: str) -> str:
    """Clean name: strip whitespace, leading @, trailing punctuation, lowercase."""
    if not name:
        return ""
    s = str(name).strip()
    if s.startswith("@"):
        s = s[1:].strip()
    s = re.sub(r"[\s" + re.escape(string.punctuation) + r"]+$", "", s)
    return s.lower()

def fold_key(name: str) -> str:
    """Fold spelling variants into comparison key using 6 strict rules."""
    s = clean_name(name)
    if not s:
        return ""
    # Rule 1: v and w become b
    s = s.replace("v", "b").replace("w", "b")
    # Rule 2: ee becomes i
    s = s.replace("ee", "i")
    # Rule 3: oo becomes u
    s = s.replace("oo", "u")
    # Rule 4: ph becomes f
    s = s.replace("ph", "f")
    # Rule 5: z becomes j
    s = s.replace("z", "j")
    # Rule 6: collapse repeated letters (e.g. Aashish -> Ashish)
    return re.sub(r"(.)\1+", r"\1", s)

class TeamMemberRef:
    def __init__(self, member_id: int, name: str, department_name: str = ""):
        self.id = member_id
        self.name = name
        self.department_name = department_name
        self.full_key = fold_key(name)
        parts = name.split()
        self.first_key = fold_key(parts[0]) if parts else self.full_key

def match_assignee(raw_name: str, members: list[TeamMemberRef]) -> tuple[TeamMemberRef | None, bool]:
    """Match raw assignee to team members. Returns (matched_member or None, is_exact_match)."""
    cleaned = clean_name(raw_name)
    if not cleaned or not members:
        return None, False

    input_key = fold_key(cleaned)
    # Check key equality on full or first name
    key_matches = [m for m in members if input_key == m.full_key or input_key == m.first_key]
    distinct_ids = {m.id for m in key_matches}
    if len(distinct_ids) == 1:
        matched = key_matches[0]
        first_clean = clean_name(matched.name.split()[0]) if matched.name.split() else ""
        is_exact = (cleaned == clean_name(matched.name)) or (cleaned == first_clean)
        return matched, is_exact
    if len(distinct_ids) > 1:
        return None, False  # Ambiguous tie

    # Fallback to difflib.SequenceMatcher (>= 0.85 ratio, >= 4 chars on both strings)
    if len(input_key) < 4:
        return None, False

    best_score = 0.0
    best_members = []
    for m in members:
        score = 0.0
        if len(m.full_key) >= 4:
            score = max(score, difflib.SequenceMatcher(None, input_key, m.full_key).ratio())
        if len(m.first_key) >= 4:
            score = max(score, difflib.SequenceMatcher(None, input_key, m.first_key).ratio())
        if score >= 0.85:
            if score > best_score + 1e-6:
                best_score = score
                best_members = [m]
            elif abs(score - best_score) <= 1e-6:
                best_members.append(m)

    distinct_best = {m.id for m in best_members}
    if len(distinct_best) == 1:
        return best_members[0], False
    return None, False
