"""Fausse implémentation minimale du client supabase-py — juste assez pour
exercer les mêmes appels que orchestrator.py / tools/duplicate_checker.py /
agent_kernel/memory.py / tools/memory.py pendant le test d'intégration du
pipeline. Pas un émulateur SQL générique : uniquement les opérations
(select/eq/in_/order/limit/single/maybe_single/insert/update/upsert)
réellement utilisées par ce backend."""
import uuid
from types import SimpleNamespace


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filters: list[tuple] = []
        self._order = None
        self._limit = None
        self._single = False
        self._maybe_single = False
        self._op = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, vals))
        return self

    def is_(self, col, val):
        if val in (None, "null"):
            self._filters.append(("isnull", col, None))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def single(self):
        self._single = True
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def insert(self, payload):
        self._op = ("insert", payload)
        return self

    def update(self, payload):
        self._op = ("update", payload)
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = ("upsert", payload, on_conflict)
        return self

    def _matched(self) -> list[dict]:
        result = []
        for row in self._rows:
            ok = True
            for f in self._filters:
                kind = f[0]
                if kind == "eq" and row.get(f[1]) != f[2]:
                    ok = False
                elif kind == "in" and row.get(f[1]) not in f[2]:
                    ok = False
                elif kind == "isnull" and row.get(f[1]) is not None:
                    ok = False
                elif kind == "lt" and not (row.get(f[1]) is not None and row.get(f[1]) < f[2]):
                    ok = False
                if not ok:
                    break
            if ok:
                result.append(row)
        return result

    def execute(self):
        if self._op:
            kind = self._op[0]
            if kind == "insert":
                items = self._op[1] if isinstance(self._op[1], list) else [self._op[1]]
                created = []
                for item in items:
                    row = {**item}
                    row.setdefault("id", str(uuid.uuid4()))
                    self._rows.append(row)
                    created.append(row)
                return SimpleNamespace(data=created)

            if kind == "update":
                matched = self._matched()
                for row in matched:
                    row.update(self._op[1])
                return SimpleNamespace(data=matched)

            if kind == "upsert":
                payload, on_conflict = self._op[1], self._op[2]
                items = payload if isinstance(payload, list) else [payload]
                conflict_cols = on_conflict.split(",") if on_conflict else []
                results = []
                for item in items:
                    existing = None
                    if conflict_cols:
                        existing = next((r for r in self._rows if all(r.get(c) == item.get(c) for c in conflict_cols)), None)
                    if existing:
                        existing.update(item)
                        results.append(existing)
                    else:
                        row = {**item}
                        row.setdefault("id", str(uuid.uuid4()))
                        self._rows.append(row)
                        results.append(row)
                return SimpleNamespace(data=results)

        matched = self._matched()
        if self._order:
            col, desc = self._order
            matched = sorted(matched, key=lambda r: r.get(col) or "", reverse=desc)
        if self._limit:
            matched = matched[: self._limit]
        if self._single or self._maybe_single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class FakeSupabase:
    def __init__(self):
        self._store: dict[str, list[dict]] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._store.setdefault(name, []))
