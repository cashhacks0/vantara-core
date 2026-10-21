"""Project workspaces: scaffolding, safe files, checkpoints, diffs, commands, memory."""

from __future__ import annotations

import asyncio
import difflib
import json
import mimetypes
import os
import re
import shlex
import shutil
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from ..core.config import Settings
from ..core.db import Database, new_id, utc_now
from ..core.logging import get_logger
from ..security import safe_filename, safe_join

log = get_logger(__name__)

PROJECT_KINDS = {
    "static": "Website / static app",
    "game": "Playable browser game",
    "python": "Python project",
    "node": "Node.js project",
    "blank": "Blank workspace",
}
EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "dist", ".checkpoints", ".vantara"}
TEXT_SUFFIXES = {
    ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".py",
    ".yml", ".yaml", ".toml", ".svg", ".csv", ".xml", ".sh", ".gitignore",
}
MAX_READ = 512 * 1024
MAX_WRITE = 512 * 1024
MAX_OUTPUT = 120_000


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-").lower()
    return (cleaned or "project")[:48]


def infer_kind(prompt: str, explicit: str | None = None) -> str:
    if explicit in PROJECT_KINDS:
        return explicit
    lowered = prompt.lower()
    if any(word in lowered for word in ("game", "platformer", "shooter", "rpg", "arcade", "player movement")):
        return "game"
    if any(word in lowered for word in ("python", "pytest", "script", "cli tool")):
        return "python"
    if any(word in lowered for word in ("node.js", "nodejs", "express api", "npm package")):
        return "node"
    return "static"


STATIC_FILES = {
    "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New VANTARA project</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="nav"><strong>VANTARA</strong><nav><a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a></nav></header>
  <main>
    <section class="hero">
      <p class="eyebrow">Local-first creation</p>
      <h1>Build something worth sharing.</h1>
      <p class="lead">This starter project is ready to be shaped by your local AI team.</p>
      <a class="button" href="#work">Explore</a>
    </section>
    <section id="work" class="grid">
      <article><h2>Fast</h2><p>Everything runs on this machine.</p></article>
      <article><h2>Open</h2><p>Editable source files, no lock-in.</p></article>
      <article><h2>Yours</h2><p>Your data and project stay local.</p></article>
    </section>
    <section id="about" class="panel"><h2>About</h2><p>Describe the change you want in the AI Terminal and review the diff before keeping it.</p></section>
    <section id="contact" class="panel"><h2>Contact</h2><p>Replace this with your details.</p></section>
  </main>
  <script src="app.js"></script>
</body>
</html>
""",
    "styles.css": """:root{color-scheme:dark;--bg:#09090b;--panel:#121216;--line:#26262e;--text:#f4f4f5;--muted:#8d8d99;--accent:#8b5cf6}*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px circle at 10% -10%,#2a1a4a,transparent 55%),var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;line-height:1.6}.nav{display:flex;justify-content:space-between;align-items:center;padding:20px 6vw;border-bottom:1px solid var(--line)}.nav nav{display:flex;gap:18px}.nav a{color:var(--muted);text-decoration:none;font-size:14px}.nav a:hover{color:#fff}main{max-width:1050px;margin:0 auto;padding:0 6vw}.hero{padding:110px 0 80px;max-width:720px}.eyebrow{color:#a78bfa;font-size:12px;letter-spacing:.18em;text-transform:uppercase}.hero h1{font-size:clamp(36px,6vw,64px);line-height:1.05;margin:12px 0}.lead{color:var(--muted);font-size:17px;max-width:560px}.button{display:inline-block;margin-top:18px;background:var(--accent);color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;padding-bottom:50px}.grid article,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px}.grid h2,.panel h2{margin:0 0 6px;font-size:16px}.grid p,.panel p{margin:0;color:var(--muted);font-size:14px}.panel{margin-bottom:20px;padding:28px}footer{padding:30px 6vw;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}""",
    "app.js": """document.querySelectorAll('a[href^=\"#\"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
console.info('VANTARA static project ready');
""",
    "README.md": "# New VANTARA project\n\nA local-first website scaffold. Open the AI Terminal and describe the site you want.\n\nPreview is available from the AI Terminal.\n",
}

GAME_FILES = {
    "index.html": """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VANTARA Game Prototype</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070a;color:#f4f4f5;font-family:system-ui,sans-serif}
  .frame{width:min(960px,96vw);border:1px solid #2a2a33;border-radius:16px;overflow:hidden;background:#0d0d12;box-shadow:0 30px 80px -40px #000}
  header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #26262e;font-size:12px;color:#8d8d99}
  canvas{display:block;width:100%;height:auto;background:#101018;touch-action:none}
  .hud{position:absolute;left:16px;top:16px;font:600 12px ui-monospace,monospace;color:#a78bfa;pointer-events:none}
  .wrap{position:relative}
  footer{padding:9px 16px;border-top:1px solid #26262e;color:#61616d;font-size:11px}
</style>
</head>
<body>
<div class="frame">
  <header><strong>VANTARA · Orb Collector</strong><span id="scoreLabel">Score 0</span></header>
  <div class="wrap"><canvas id="game" width="960" height="540"></canvas><div class="hud" id="hud">WASD / arrows to move</div></div>
  <footer>Local prototype · collect the violet orbs · R to restart</footer>
</div>
<script src="game.js"></script>
</body>
</html>
""",
    "game.js": """:
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreLabel = document.getElementById('scoreLabel');
const keys = new Set();
const player = { x: 480, y: 270, r: 14, speed: 250 };
let orbs = [];
let score = 0;
let last = performance.now();

function spawnOrb() {
  orbs = [{ x: 60 + Math.random() * (canvas.width - 120), y: 60 + Math.random() * (canvas.height - 120), r: 10 }];
}

function reset() {
  score = 0; player.x = 480; player.y = 270; spawnOrb(); updateHud();
}

function updateHud() { scoreLabel.textContent = `Score ${score}`; }

addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
  if (event.key.toLowerCase() === 'r') reset();
});
addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

function update(dt) {
  let dx = 0, dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (dx || dy) { const len = Math.hypot(dx, dy); player.x += (dx / len) * player.speed * dt; player.y += (dy / len) * player.speed * dt; }
  player.x = Math.max(player.r, Math.min(canvas.width - player.r, player.x));
  player.y = Math.max(player.r, Math.min(canvas.height - player.r, player.y));
  for (const orb of orbs) {
    if (Math.hypot(orb.x - player.x, orb.y - player.y) < orb.r + player.r) { score += 10; spawnOrb(); updateHud(); }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createRadialGradient(480, 270, 20, 480, 270, 620);
  gradient.addColorStop(0, '#1a1630'); gradient.addColorStop(1, '#0a0a10');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const orb of orbs) {
    ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.r + Math.sin(performance.now() / 300) * 2, 0, Math.PI * 2);
    ctx.fillStyle = '#a78bfa'; ctx.shadowColor = '#8b5cf6'; ctx.shadowBlur = 24; ctx.fill(); ctx.shadowBlur = 0;
  }
  ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fillStyle = '#5b8cff'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw(); requestAnimationFrame(loop);
}

reset(); requestAnimationFrame(loop);
""",
    "README.md": "# VANTARA Game Prototype\n\nA dependency-free HTML5 canvas game. Collect orbs with WASD/arrows, press R to restart.\n\nAsk the AI Terminal to add enemies, levels, sound, or new mechanics. Every change is checkpointed and previewable.\n",
}

PYTHON_FILES = {
    "main.py": """\"\"\"Local VANTARA Python project.\"\"\"\n\nfrom __future__ import annotations\n\n
def greet(name: str) -> str:\n    return f\"Hello, {name}! Your local project is ready.\"\n\n\nif __name__ == \"__main__\":\n    print(greet(\"VANTARA\"))\n""",
    "test_main.py": """from main import greet\n\n\ndef test_greet():\n    assert greet(\"World\") == \"Hello, World! Your local project is ready.\"\n""",
    "README.md": "# VANTARA Python Project\n\nRun the app with `python main.py` and tests with `python -m pytest`.\n\nThe AI Terminal can edit files and run the allowlisted validation commands.\n",
}

NODE_FILES = {
    "package.json": json.dumps({"name": "vantara-node-project", "version": "0.1.0", "private": True, "type": "module", "scripts": {"test": "node --test", "start": "node src/index.js"}}, indent=2) + "\n",
    "src/index.js": "export function greet(name) {\n  return `Hello, ${name}! Your local Node project is ready.`;\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  console.log(greet('VANTARA'));\n}\n",
    "test/index.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/index.js';\n\ntest('greets a name', () => {\n  assert.equal(greet('World'), 'Hello, World! Your local Node project is ready.');\n});\n",
    "README.md": "# VANTARA Node Project\n\nRun `npm test` or `npm start`. No dependencies are required.\n",
}

BLANK_FILES = {
    "README.md": "# New project\n\nDescribe what you want to build in the AI Terminal. Files created by the AI are real and checkpointed.\n",
}


class ProjectService:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings
        self.root = settings.projects_dir
        self.checkpoint_root = settings.projects_dir.parent / "checkpoints"

    # ------------------------------------------------------------- projects
    def list_projects(self) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT p.*, "
            "(SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS task_count, "
            "(SELECT MAX(started_at) FROM project_tasks t WHERE t.project_id = p.id) AS last_task_at "
            "FROM projects p ORDER BY p.updated_at DESC"
        )
        return [self._public(row) for row in rows]

    def get_project(self, project_id: str) -> dict[str, Any]:
        row = self._row(project_id)
        files = self.tree(project_id)
        return {
            **self._public(row),
            "files": files,
            "memory_count": len(self.list_memory(project_id)),
            "latest_checkpoint": self.latest_checkpoint(project_id),
        }

    def create_project(
        self, name: str | None, description: str, kind: str | None = None, prompt: str = ""
    ) -> dict[str, Any]:
        inferred = infer_kind(prompt or description or name or "", kind)
        base_name = (name or (prompt or description or "New project").strip().splitlines()[0])[:80]
        slug = _slug(base_name)
        project_id = new_id("proj_")
        directory = self.root / f"{slug}-{project_id[-8:]}"
        directory = safe_join(self.root, directory.name)
        directory.mkdir(parents=True, exist_ok=False)
        now = utc_now()
        self.db.insert(
            "projects",
            {
                "id": project_id,
                "name": base_name[:80] or "New project",
                "description": description[:1000],
                "kind": inferred,
                "path": str(directory),
                "preview_entry": "index.html" if inferred in {"static", "game"} else None,
                "status": "active",
                "metadata_json": json.dumps({"template": inferred}),
                "created_at": now,
                "updated_at": now,
            },
        )
        templates = {"static": STATIC_FILES, "game": GAME_FILES, "python": PYTHON_FILES,
                     "node": NODE_FILES, "blank": BLANK_FILES}
        for relative, content in templates.get(inferred, BLANK_FILES).items():
            target = safe_join(directory, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        if description.strip():
            self.add_memory(project_id, "requirement", description.strip()[:4000], source="project creation", verified=True)
        self.create_checkpoint(project_id, "Initial scaffold")
        self.db.audit("project.created", f"{project_id}:{inferred}")
        return self.get_project(project_id)

    def delete_project(self, project_id: str) -> None:
        row = self._row(project_id)
        directory = Path(row["path"]).resolve()
        if self.root.resolve() in directory.parents and directory.exists():
            shutil.rmtree(directory)
        checkpoint_dir = self.checkpoint_root / project_id
        if checkpoint_dir.exists():
            shutil.rmtree(checkpoint_dir, ignore_errors=True)
        self.db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        self.db.audit("project.deleted", project_id)

    def _row(self, project_id: str) -> dict[str, Any]:
        row = self.db.query_one("SELECT * FROM projects WHERE id = ?", (project_id,))
        if not row:
            raise KeyError("Project not found")
        return row

    def _project_dir(self, project_id: str) -> Path:
        row = self._row(project_id)
        directory = Path(row["path"]).resolve()
        if self.root.resolve() not in directory.parents:
            raise ValueError("Project path escapes the projects directory")
        if not directory.exists():
            raise FileNotFoundError("Project directory is missing")
        return directory

    def _public(self, row: dict[str, Any]) -> dict[str, Any]:
        try:
            metadata = json.loads(row.get("metadata_json") or "{}")
        except json.JSONDecodeError:
            metadata = {}
        return {
            "id": row["id"], "name": row["name"], "description": row["description"],
            "kind": row["kind"], "kind_label": PROJECT_KINDS.get(row["kind"], row["kind"]),
            "path": row["path"], "preview_entry": row["preview_entry"],
            "status": row["status"], "metadata": metadata,
            "created_at": row["created_at"], "updated_at": row["updated_at"],
            "task_count": row.get("task_count", 0), "last_task_at": row.get("last_task_at"),
        }

    # ---------------------------------------------------------------- files
    def _safe_file(self, project_id: str, relative: str, must_exist: bool = True) -> Path:
        cleaned = str(relative or "").replace("\\", "/").strip("/")
        if not cleaned:
            raise ValueError("A file path is required")
        parts = [part for part in cleaned.split("/") if part]
        if any(part in {".", ".."} for part in parts):
            raise ValueError("Invalid file path")
        if any(part in EXCLUDED_DIRS for part in parts):
            raise ValueError("That directory is not accessible")
        target = safe_join(self._project_dir(project_id), *parts)
        if must_exist and not target.is_file():
            raise FileNotFoundError(f"File not found: {cleaned}")
        if target.exists() and target.is_dir():
            raise ValueError("Path is a directory")
        return target

    def tree(self, project_id: str) -> list[dict[str, Any]]:
        root = self._project_dir(project_id)
        entries: list[dict[str, Any]] = []
        for directory, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(name for name in dirnames if name not in EXCLUDED_DIRS)
            for filename in sorted(filenames):
                path = Path(directory) / filename
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                relative = path.relative_to(root).as_posix()
                entries.append({"path": relative, "size": size, "modified_at": path.stat().st_mtime})
                if len(entries) >= 500:
                    return entries
        return entries

    def read_file(self, project_id: str, relative: str) -> dict[str, Any]:
        path = self._safe_file(project_id, relative)
        size = path.stat().st_size
        if size > MAX_READ:
            raise ValueError(f"File is too large to edit ({size} bytes; limit {MAX_READ}).")
        data = path.read_bytes()
        if b"\x00" in data[:4096]:
            raise ValueError("Binary files cannot be opened in the text editor.")
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("File is not valid UTF-8 text.") from exc
        return {
            "path": relative.replace("\\", "/"), "content": content, "size": size,
            "modified_at": path.stat().st_mtime, "language": path.suffix.lstrip(".") or "text",
        }

    def write_file(self, project_id: str, relative: str, content: str) -> dict[str, Any]:
        if len(content.encode("utf-8")) > MAX_WRITE:
            raise ValueError(f"File exceeds the {MAX_WRITE // 1024} KB write limit.")
        path = self._safe_file(project_id, relative, must_exist=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        self._touch(project_id)
        return {"path": relative, "size": path.stat().st_size, "modified_at": path.stat().st_mtime}

    def delete_file(self, project_id: str, relative: str) -> None:
        path = self._safe_file(project_id, relative)
        path.unlink()
        self._touch(project_id)

    def _touch(self, project_id: str) -> None:
        self.db.update("projects", project_id, {"updated_at": utc_now()})

    def preview_file(self, project_id: str, relative: str | None = None) -> tuple[Path, str]:
        row = self._row(project_id)
        entry = relative or row.get("preview_entry") or "index.html"
        path = self._safe_file(project_id, entry)
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return path, mime

    # ----------------------------------------------------------- checkpoints
    def create_checkpoint(self, project_id: str, label: str, task_id: str | None = None) -> dict[str, Any]:
        root = self._project_dir(project_id)
        checkpoint_id = new_id("cp_")
        target_dir = self.checkpoint_root / project_id
        target_dir.mkdir(parents=True, exist_ok=True)
        archive = target_dir / f"{checkpoint_id}.zip"
        count = 0
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                if any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts):
                    continue
                if path.stat().st_size > 2 * 1024 * 1024:
                    continue
                bundle.write(path, path.relative_to(root).as_posix())
                count += 1
        record = {
            "id": checkpoint_id, "project_id": project_id, "label": label[:200],
            "task_id": task_id, "path": str(archive), "file_count": count,
            "created_at": utc_now(),
        }
        self.db.insert("project_checkpoints", record)
        self._rotate_checkpoints(project_id)
        return {k: v for k, v in record.items() if k != "path"}

    def _rotate_checkpoints(self, project_id: str, keep: int = 30) -> None:
        rows = self.db.query(
            "SELECT id, path FROM project_checkpoints WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        )
        for row in rows[keep:]:
            try:
                Path(row["path"]).unlink(missing_ok=True)
            except OSError:
                pass
            self.db.execute("DELETE FROM project_checkpoints WHERE id = ?", (row["id"],))

    def list_checkpoints(self, project_id: str) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT id, project_id, label, task_id, file_count, created_at "
            "FROM project_checkpoints WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        )
        return rows

    def latest_checkpoint(self, project_id: str) -> dict[str, Any] | None:
        rows = self.list_checkpoints(project_id)
        return rows[0] if rows else None

    def restore_checkpoint(self, project_id: str, checkpoint_id: str) -> dict[str, Any]:
        row = self.db.query_one(
            "SELECT * FROM project_checkpoints WHERE id = ? AND project_id = ?",
            (checkpoint_id, project_id),
        )
        if not row:
            raise KeyError("Checkpoint not found")
        archive = Path(row["path"])
        if not archive.exists():
            raise FileNotFoundError("Checkpoint archive is missing")
        self.create_checkpoint(project_id, "Before restore", task_id=None)
        root = self._project_dir(project_id)
        staging = Path(tempfile.mkdtemp(prefix="vantara-restore-", dir=str(self.settings.cache_dir)))
        try:
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.infolist():
                    if member.filename.startswith("/") or ".." in Path(member.filename).parts:
                        raise ValueError("Checkpoint contains an unsafe path")
                bundle.extractall(staging)
            for current in list(root.iterdir()):
                if current.is_dir():
                    shutil.rmtree(current)
                else:
                    current.unlink()
            for item in list(staging.iterdir()):
                destination = root / item.name
                if item.is_dir():
                    shutil.copytree(item, destination)
                else:
                    shutil.copy2(item, destination)
            self._touch(project_id)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        self.db.audit("project.restored", f"{project_id}:{checkpoint_id}")
        return {"restored": checkpoint_id, "label": row["label"]}

    # ----------------------------------------------------------------- diff
    def diff(self, project_id: str, checkpoint_id: str | None = None) -> dict[str, Any]:
        row = None
        if checkpoint_id:
            row = self.db.query_one(
                "SELECT * FROM project_checkpoints WHERE id = ? AND project_id = ?",
                (checkpoint_id, project_id),
            )
        if row is None:
            latest = self.latest_checkpoint(project_id)
            if latest:
                row = self.db.query_one("SELECT * FROM project_checkpoints WHERE id = ?", (latest["id"],))
        if not row:
            return {"checkpoint": None, "files": [], "truncated": False, "summary": {"added": 0, "removed": 0, "changed": 0}}
        root = self._project_dir(project_id)
        previous: dict[str, str] = {}
        try:
            with zipfile.ZipFile(row["path"]) as bundle:
                for name in bundle.namelist():
                    suffix = Path(name).suffix.lower()
                    if suffix not in TEXT_SUFFIXES and Path(name).name not in {".gitignore"}:
                        continue
                    info = bundle.getinfo(name)
                    if info.file_size > MAX_READ:
                        continue
                    try:
                        previous[name] = bundle.read(name).decode("utf-8")
                    except (UnicodeDecodeError, KeyError):
                        continue
        except (OSError, zipfile.BadZipFile):
            raise ValueError("Checkpoint archive could not be read")
        current: dict[str, str] = {}
        for entry in self.tree(project_id):
            suffix = Path(entry["path"]).suffix.lower()
            if suffix not in TEXT_SUFFIXES and Path(entry["path"]).name not in {".gitignore"}:
                continue
            if entry["size"] > MAX_READ:
                continue
            try:
                current[entry["path"]] = (root / entry["path"]).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
        files: list[dict[str, Any]] = []
        summary = {"added": 0, "removed": 0, "changed": 0}
        chars = 0
        for name in sorted(set(previous) | set(current)):
            before = previous.get(name, "")
            after = current.get(name, "")
            if before == after:
                continue
            status = "added" if name not in previous else "removed" if name not in current else "changed"
            summary[status] += 1
            diff_text = "".join(
                difflib.unified_diff(
                    before.splitlines(keepends=True), after.splitlines(keepends=True),
                    fromfile=f"a/{name}" if before else "/dev/null",
                    tofile=f"b/{name}" if after else "/dev/null",
                    n=3,
                )
            )
            chars += len(diff_text)
            if chars <= MAX_OUTPUT:
                files.append({"path": name, "status": status, "diff": diff_text[:12000]})
        return {
            "checkpoint": {k: v for k, v in row.items() if k != "path"},
            "files": files, "truncated": chars > MAX_OUTPUT, "summary": summary,
        }

    # ---------------------------------------------------------------- memory
    def add_memory(self, project_id: str, kind: str, content: str, source: str | None = None, verified: bool = False) -> dict[str, Any]:
        self._row(project_id)
        if kind not in {"requirement", "decision", "note", "fix", "preference"}:
            kind = "note"
        memory_id = new_id("mem_")
        self.db.insert(
            "project_memory",
            {"id": memory_id, "project_id": project_id, "kind": kind, "content": content[:8000],
             "source": (source or "user")[:300], "verified": 1 if verified else 0, "created_at": utc_now()},
        )
        self._touch(project_id)
        row = self.db.query_one("SELECT * FROM project_memory WHERE id = ?", (memory_id,))
        assert row is not None
        row["verified"] = bool(row["verified"])
        return row

    def list_memory(self, project_id: str, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT * FROM project_memory WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
            (project_id, max(1, min(limit, 300))),
        )
        for row in rows:
            row["verified"] = bool(row["verified"])
        return rows

    def delete_memory(self, project_id: str, memory_id: str) -> None:
        self.db.execute("DELETE FROM project_memory WHERE id = ? AND project_id = ?", (memory_id, project_id))

    def relevant_memory(self, project_id: str, query: str, limit: int = 6) -> list[dict[str, Any]]:
        rows = self.list_memory(project_id, 200)
        terms = {t.lower() for t in re.findall(r"[A-Za-z0-9_]{3,}", query)}
        scored = []
        for row in rows:
            score = sum(1 for term in terms if term in row["content"].lower())
            if row["kind"] == "requirement":
                score += 2
            if row["verified"]:
                score += 1
            scored.append((score, row))
        scored.sort(key=lambda pair: (pair[0], pair[1]["created_at"]), reverse=True)
        return [row for _, row in scored[:limit]]

    # ------------------------------------------------------------- commands
    async def run_command(self, project_id: str, command: str, approved: bool = False) -> dict[str, Any]:
        if not approved:
            raise ValueError("Command execution requires explicit approval")
        args = validate_command(command)
        root = self._project_dir(project_id)
        env = {
            key: value for key, value in os.environ.items()
            if not key.upper().startswith(("VANTARA_", "HF_", "AWS_", "OPENAI", "ANTHROPIC", "GOOGLE_"))
            and key.upper() not in {"HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"}
        }
        env.update({"PYTHONDONTWRITEBYTECODE": "1", "CI": "1", "NO_COLOR": "1"})
        command_id = new_id("cmd_")
        started_at = utc_now()
        self.db.insert(
            "project_commands",
            {"id": command_id, "project_id": project_id, "command": command[:500],
             "status": "running", "exit_code": None, "stdout": None, "stderr": None,
             "started_at": started_at, "finished_at": None},
        )
        start = time.monotonic()
        status = "completed"
        exit_code: int | None = None
        stdout = ""
        stderr = ""
        try:
            process = await asyncio.create_subprocess_exec(
                *args, cwd=str(root), env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            try:
                out, err = await asyncio.wait_for(process.communicate(), timeout=45)
                stdout = out.decode("utf-8", "replace")[:MAX_OUTPUT]
                stderr = err.decode("utf-8", "replace")[:MAX_OUTPUT]
                exit_code = process.returncode
                status = "completed" if exit_code == 0 else "failed"
            except asyncio.TimeoutError:
                status = "timeout"
                try:
                    os.killpg(process.pid, 9)
                except OSError:
                    pass
                stdout = stderr = ""
                stderr = "Command exceeded the 45 second limit and was stopped."
        except FileNotFoundError:
            status = "failed"
            stderr = f"Command not found: {args[0]}"
        except OSError as exc:
            status = "failed"
            stderr = f"Command could not start: {exc}"
        self.db.update(
            "project_commands", command_id,
            {"status": status, "exit_code": exit_code, "stdout": stdout, "stderr": stderr,
             "finished_at": utc_now()},
        )
        self._touch(project_id)
        return {
            "id": command_id, "command": command, "args": args, "status": status,
            "exit_code": exit_code, "stdout": stdout, "stderr": stderr,
            "duration_ms": round((time.monotonic() - start) * 1000),
        }

    def list_commands(self, project_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return self.db.query(
            "SELECT id, project_id, command, status, exit_code, stdout, stderr, started_at, finished_at "
            "FROM project_commands WHERE project_id = ? ORDER BY started_at DESC LIMIT ?",
            (project_id, max(1, min(limit, 200))),
        )

    # ---------------------------------------------------------------- tasks
    def list_tasks(self, project_id: str, limit: int = 30) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT id, project_id, kind, prompt, model_id, status, plan_json, steps_json, output, error, "
            "checkpoint_id, started_at, finished_at FROM project_tasks WHERE project_id = ? "
            "ORDER BY started_at DESC LIMIT ?",
            (project_id, max(1, min(limit, 100))),
        )
        for row in rows:
            row["plan"] = json.loads(row.pop("plan_json") or "[]")
            row["steps"] = json.loads(row.pop("steps_json") or "[]")
        return rows

    def get_task(self, project_id: str, task_id: str) -> dict[str, Any]:
        row = self.db.query_one(
            "SELECT * FROM project_tasks WHERE id = ? AND project_id = ?", (task_id, project_id)
        )
        if not row:
            raise KeyError("Project task not found")
        row["plan"] = json.loads(row.pop("plan_json") or "[]")
        row["steps"] = json.loads(row.pop("steps_json") or "[]")
        return row


def validate_command(command: str) -> list[str]:
    """Parse and allowlist a command. No shell, chaining, redirection, or absolute paths."""
    if not command or len(command) > 500 or "\n" in command or "\r" in command:
        raise ValueError("Command is empty, too long, or contains newlines")
    if re.search(r"[;&|><`$]", command):
        raise ValueError("Shell operators, redirects, and substitutions are not allowed")
    try:
        args = shlex.split(command, posix=True)
    except ValueError as exc:
        raise ValueError(f"Could not parse command: {exc}") from exc
    if not args:
        raise ValueError("Command is empty")
    for arg in args:
        if arg.startswith("/") or arg == "~" or arg.startswith("~/") or ".." in Path(arg).parts:
            raise ValueError("Absolute paths and parent-directory paths are not allowed")
    name = args[0]
    rest = args[1:]
    if name in {"pwd", "ls", "cat", "head", "tail", "wc", "grep"}:
        return args
    if name == "find":
        if any(flag in {"-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprintf"} for flag in rest):
            raise ValueError("That find operation is blocked")
        return args
    if name == "git":
        if not rest or rest[0] not in {"status", "diff", "log", "show"}:
            raise ValueError("Only git status/diff/log/show are allowed")
        if any(flag in {"-c", "--exec-path", "--upload-pack"} for flag in rest):
            raise ValueError("That git option is blocked")
        return args
    if name == "node":
        if len(rest) == 2 and rest[0] == "--check" and rest[1].endswith((".js", ".mjs", ".cjs")):
            return args
        if len(rest) == 1 and rest[0].endswith((".js", ".mjs", ".cjs")):
            return args
        raise ValueError("Only `node --check <file>` or `node <file>` is allowed")
    if name == "npm":
        if rest in (["test"], ["run", "build"], ["run", "lint"], ["run", "test"]):
            return args
        raise ValueError("Only `npm test`, `npm run build`, `npm run lint`, or `npm run test` are allowed")
    if name == "npx":
        if rest == ["tsc", "--noEmit"]:
            return args
        raise ValueError("Only `npx tsc --noEmit` is allowed")
    if name in {"python", "python3"}:
        if rest[:2] == ["-m", "pytest"]:
            _validate_pytest_args(rest[2:])
            return args
        if rest[:2] == ["-m", "py_compile"] and len(rest) == 3 and rest[2].endswith(".py"):
            return args
        if len(rest) == 1 and rest[0].endswith(".py"):
            return args
        raise ValueError("Only `python <file.py>`, `python -m pytest`, or `python -m py_compile <file>` are allowed")
    if name == "pytest":
        _validate_pytest_args(rest)
        return args
    if name == "tsc":
        if rest == ["--noEmit"]:
            return args
        raise ValueError("Only `tsc --noEmit` is allowed")
    raise ValueError(f"Command '{name}' is not in the allowlist")


def _validate_pytest_args(args: list[str]) -> None:
    forbidden = ("-p", "--pyargs", "--import-mode", "-c", "--config-file")
    for arg in args:
        if arg.startswith(forbidden):
            raise ValueError("That pytest option is blocked")
