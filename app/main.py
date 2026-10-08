"""Meeting Tickets — FastAPI backend.

Manages whisper-server and llama-server processes,
proxies requests, and streams diagnostics via SSE.
"""

import asyncio, hashlib, json, logging, mimetypes, os, re, shutil, sqlite3, subprocess, time, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.assignee_match import match_assignee, TeamMemberRef

# Ensure common audio MIME types are registered
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/webm", ".webm")
mimetypes.add_type("audio/flac", ".flac")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("audio/mpeg", ".mp3")

# ── Logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("meeting-tickets")

# ── Paths ──────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.yaml"
PROMPT_PATH = BASE_DIR / "prompts" / "tickets.txt"
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "meeting_tickets.db"
BACKUP_PATH = DATA_DIR / "backup-before-tickets-migration.db"
TEAM_BACKUP_PATH = DATA_DIR / "backup-before-team-migration.db"

# ── SQLite Database ────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        # Check if backup is needed before team migration
        dept_exists_before = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='departments'"
        ).fetchone() is not None

        ticket_tbl_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tickets'"
        ).fetchone() is not None
        ticket_cols_before = [row["name"] for row in conn.execute("PRAGMA table_info(tickets)").fetchall()] if ticket_tbl_exists else []

        needs_team_migration = (not dept_exists_before) or ("assignee_member_id" not in ticket_cols_before)
        if needs_team_migration and DB_PATH.exists() and not TEAM_BACKUP_PATH.exists():
            shutil.copy2(DB_PATH, TEAM_BACKUP_PATH)
            log.info(f"Created database backup before team migration at {TEAM_BACKUP_PATH}")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                input_type TEXT NOT NULL,
                transcript TEXT NOT NULL,
                tickets_json TEXT NOT NULL,
                whisper_model TEXT,
                llm_model TEXT,
                audio_file TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                assignee TEXT,
                priority TEXT NOT NULL,
                acceptance_criteria TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_tickets_meeting_id ON tickets(meeting_id);

            CREATE TABLE IF NOT EXISTS departments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                department_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_team_members_department_id ON team_members(department_id);
        """)

        # Seed initial departments only when the table was first created
        if not dept_exists_before:
            now_str = datetime.now(timezone.utc).isoformat()
            seed_depts = ["Web Dev", "Mobile Dev", "Database", "QA", "DevOps"]
            for d_name in seed_depts:
                conn.execute(
                    "INSERT INTO departments (name, created_at, updated_at) VALUES (?, ?, ?)",
                    (d_name, now_str, now_str)
                )
            log.info(f"Seeded initial {len(seed_depts)} departments: {', '.join(seed_depts)}")

        # Migration: check if audio_file column exists on existing databases
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(meetings)").fetchall()]
        if "audio_file" not in columns:
            conn.execute("ALTER TABLE meetings ADD COLUMN audio_file TEXT;")
            log.info("Migrated meetings table: added audio_file column")

        # Migration: check if assignee_member_id column exists on tickets table
        t_columns = [row["name"] for row in conn.execute("PRAGMA table_info(tickets)").fetchall()]
        if "assignee_member_id" not in t_columns:
            conn.execute("ALTER TABLE tickets ADD COLUMN assignee_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_assignee_member ON tickets(assignee_member_id);")
            log.info("Migrated tickets table: added assignee_member_id column")

        # Idempotent migration: check for meetings that have tickets_json but no rows in tickets table
        unmigrated_rows = conn.execute("""
            SELECT m.id, m.created_at, m.tickets_json
            FROM meetings m
            WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.meeting_id = m.id)
        """).fetchall()

        meetings_to_migrate = []
        for row in unmigrated_rows:
            try:
                raw_tickets = json.loads(row["tickets_json"]) if row["tickets_json"] else []
                if isinstance(raw_tickets, list) and len(raw_tickets) > 0:
                    meetings_to_migrate.append((row["id"], row["created_at"], raw_tickets))
            except Exception as e:
                log.warning(f"Could not parse tickets_json for meeting {row['id']}: {e}")

        if meetings_to_migrate:
            # Backup before first migration if not already created
            if DB_PATH.exists() and not BACKUP_PATH.exists():
                shutil.copy2(DB_PATH, BACKUP_PATH)
                log.info(f"Created database backup before tickets migration at {BACKUP_PATH}")

            migrated_ticket_count = 0
            for meeting_id, created_at, raw_tickets in meetings_to_migrate:
                now_str = created_at or datetime.now(timezone.utc).isoformat()
                for pos, t in enumerate(raw_tickets):
                    title = str(t.get("title") or "Untitled Ticket").strip()
                    desc = str(t.get("description") or "")
                    assignee = t.get("assignee")
                    if assignee:
                        assignee = str(assignee).strip()
                    priority = str(t.get("priority") or "medium").lower()
                    if priority not in ("low", "medium", "high"):
                        priority = "medium"
                    ac = t.get("acceptance_criteria") or []
                    if not isinstance(ac, list):
                        ac = []
                    ac_json = json.dumps(ac)
                    status = "pending"

                    conn.execute("""
                        INSERT INTO tickets (
                            meeting_id, position, title, description, assignee,
                            priority, acceptance_criteria, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (meeting_id, pos, title, desc, assignee, priority, ac_json, status, now_str, now_str))
                    migrated_ticket_count += 1

            log.info(f"Migrated {migrated_ticket_count} tickets across {len(meetings_to_migrate)} meetings into tickets table")

    log.info(f"Database initialized at {DB_PATH}")

init_db()

# ── Load config ────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)

CFG = load_config()

def get_system_prompt() -> str:
    return PROMPT_PATH.read_text()

# ── GPU backend detection ─────────────────────────────────────────
def detect_backend() -> str:
    """Return 'cuda' if nvidia-smi works, else 'vulkan'."""
    setting = CFG.get("backend", "auto")
    if setting in ("cuda", "vulkan"):
        return setting
    try:
        subprocess.run(["nvidia-smi"], capture_output=True, check=True, timeout=5)
        return "cuda"
    except Exception:
        return "vulkan"

BACKEND = detect_backend()
log.info(f"GPU backend: {BACKEND}")

def detect_gpu_name() -> str:
    """Best-effort GPU name."""
    try:
        if BACKEND == "cuda":
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                timeout=5, text=True,
            )
            return out.strip().split("\n")[0]
        # Try lspci for AMD
        out = subprocess.check_output(["lspci"], timeout=5, text=True)
        for line in out.splitlines():
            if "VGA" in line or "Display" in line:
                # Extract the part after the colon
                parts = line.split(": ", 1)
                if len(parts) > 1:
                    return parts[1].strip()
    except Exception:
        pass
    return "unknown"

GPU_NAME = detect_gpu_name()
log.info(f"GPU: {GPU_NAME}")

def get_vram_info() -> Optional[dict]:
    """Try to read VRAM usage. Returns dict or None."""
    try:
        if BACKEND == "cuda":
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                timeout=5, text=True,
            )
            used, total = [int(x.strip()) for x in out.strip().split(",")]
            return {"used_mb": used, "total_mb": total}
    except Exception:
        pass
    return None

# ── Server process management ─────────────────────────────────────
class ServerProcess:
    """Wraps a whisper-server or llama-server child process."""

    def __init__(self, name: str):
        self.name = name              # "whisper" or "llama"
        self.proc: Optional[subprocess.Popen] = None
        self.model_id: Optional[str] = None
        self.status = "down"          # down | loading | up | error
        self.error: Optional[str] = None
        self.load_time: Optional[float] = None
        self._cmd: list[str] = []     # the command that started the server

    @property
    def port(self) -> int:
        return CFG["whisper_port"] if self.name == "whisper" else CFG["llama_port"]

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def build_cmd(self, model_cfg: dict) -> list[str]:
        """Build the command line for starting the server."""
        if self.name == "whisper":
            cmd = [
                CFG["whisper_bin"],
                "--model", model_cfg["path"],
                "--port", str(self.port),
                "--host", "127.0.0.1",
            ]
        else:
            cmd = [
                CFG["llama_bin"],
                "--model", model_cfg["path"],
                "--port", str(self.port),
                "--host", "127.0.0.1",
                "-ngl", "99",         # full GPU offload
                "-fa", "auto",        # flash attention auto
                "--jinja",            # enable Jinja templates for chat
                "--ctx-size", "8192", # reasonable context window
            ]
            # Per-model flags (e.g. --reasoning off for Qwen3)
            extra = model_cfg.get("extra_flags", [])
            if extra:
                cmd.extend(extra)
        return cmd

    def build_env(self) -> dict:
        """Build environment variables for the server process."""
        env = os.environ.copy()
        if self.name == "whisper":
            # Whisper needs its own libs on LD_LIBRARY_PATH
            lib_path = CFG.get("whisper_lib_path", "")
            if lib_path:
                existing = env.get("LD_LIBRARY_PATH", "")
                env["LD_LIBRARY_PATH"] = f"{lib_path}:{existing}" if existing else lib_path
        else:
            # llama-server: add vulkan lib dir if using vulkan backend
            if BACKEND == "vulkan":
                vulkan_dir = CFG.get("llama_vulkan_lib", "")
                if vulkan_dir:
                    existing = env.get("LD_LIBRARY_PATH", "")
                    env["LD_LIBRARY_PATH"] = f"{vulkan_dir}:{existing}" if existing else vulkan_dir
        return env

    async def start(self, model_cfg: dict) -> None:
        """Start (or restart) the server with a new model."""
        await self.stop()
        self.status = "loading"
        self.error = None
        self.model_id = model_cfg["id"]
        self._cmd = self.build_cmd(model_cfg)
        env = self.build_env()
        log.info(f"Starting {self.name}-server: {' '.join(self._cmd)}")

        t0 = time.monotonic()
        try:
            if self.name == "llama" and model_cfg.get("ollama_name"):
                # Preload model into GPU VRAM indefinitely
                async with httpx.AsyncClient(timeout=120) as client:
                    await client.post(
                        "http://127.0.0.1:11434/api/generate",
                        json={"model": model_cfg["ollama_name"], "keep_alive": -1},
                    )
            else:
                self.proc = subprocess.Popen(
                    self._cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    env=env,
                )
                # Wait for health check (up to 120s for large models)
                await self._wait_healthy(timeout=120)

            self.load_time = round(time.monotonic() - t0, 1)
            self.status = "up"
            log.info(f"{self.name}-server UP in {self.load_time}s (model: {model_cfg['name']})")
        except Exception as e:
            self.status = "error"
            self.error = str(e)
            self.load_time = round(time.monotonic() - t0, 1)
            log.error(f"{self.name}-server failed: {e}")
            raise

    async def _wait_healthy(self, timeout: float = 120):
        """Poll the health endpoint until it responds 200."""
        deadline = time.monotonic() + timeout
        url = f"{self.base_url}/health"
        async with httpx.AsyncClient() as client:
            while time.monotonic() < deadline:
                # Check if process died
                if self.proc and self.proc.poll() is not None:
                    # Read whatever output we can
                    out = ""
                    if self.proc.stdout:
                        out = self.proc.stdout.read().decode(errors="replace")[-2000:]
                    raise RuntimeError(
                        f"{self.name}-server exited with code {self.proc.returncode}. "
                        f"Output:\n{out}"
                    )
                try:
                    r = await client.get(url, timeout=3)
                    if r.status_code == 200:
                        return
                except httpx.ConnectError:
                    pass
                except Exception:
                    pass
                await asyncio.sleep(0.5)
        raise TimeoutError(f"{self.name}-server did not become healthy in {timeout}s")

    async def stop(self):
        """Kill the server process or unload the model."""
        if self.name == "llama" and self.model_id:
            m = get_model(self.model_id)
            if m and m.get("ollama_name"):
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        await client.post(
                            "http://127.0.0.1:11434/api/generate",
                            json={"model": m["ollama_name"], "keep_alive": 0},
                        )
                except Exception:
                    pass
        if self.proc and self.proc.poll() is None:
            log.info(f"Stopping {self.name}-server (pid {self.proc.pid})")
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        self.proc = None
        self.status = "down"
        self.model_id = None
        self.load_time = None

    def info(self) -> dict:
        return {
            "name": self.name,
            "status": self.status,
            "model_id": self.model_id,
            "load_time_s": self.load_time,
            "error": self.error,
            "port": self.port,
            "cmd": " ".join(self._cmd) if self._cmd else None,
        }


# Global server instances
whisper_srv = ServerProcess("whisper")
llama_srv = ServerProcess("llama")

# ── Model helpers ──────────────────────────────────────────────────
def get_model(model_id: str) -> Optional[dict]:
    for m in CFG["models"]:
        if m["id"] == model_id:
            return m
    return None

def model_availability() -> list[dict]:
    """Return all models with an 'available' flag and expected path."""
    result = []
    for m in CFG["models"]:
        exists = os.path.isfile(m["path"])
        result.append({
            **m,
            "available": exists,
            "file_size_mb": round(os.path.getsize(m["path"]) / 1e6, 1) if exists else None,
        })
    return result

# ── Job / diagnostics store (in-memory) ───────────────────────────
class Job:
    """Tracks a ticket-generation job and its stage events."""

    def __init__(self, job_id: str):
        self.id = job_id
        self.created = datetime.now(timezone.utc).isoformat()
        self.events: list[dict] = []
        self._listeners: list[asyncio.Queue] = []

    def emit(self, stage: str, status: str, **details):
        """Add an event and notify all SSE listeners."""
        evt = {
            "stage": stage,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_s": None,
            **details,
        }
        self.events.append(evt)
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        log.info(f"[job {self.id[:8]}] {stage}: {status} {json.dumps({k:v for k,v in details.items() if k not in ('raw_output',)}, default=str)}")
        for q in self._listeners:
            q.put_nowait(evt)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        # Send all past events
        for e in self.events:
            q.put_nowait(e)
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self._listeners:
            self._listeners.remove(q)


JOBS: dict[str, Job] = {}

# ── FastAPI app ────────────────────────────────────────────────────
app = FastAPI(title="Meeting Tickets", version="0.1.0")

# Serve static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ── Routes ─────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


# ── Project Schemas & Endpoints ────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: str
    description: Optional[str] = None


@app.get("/api/projects")
async def list_projects():
    """List all projects ordered newest first, with meeting_count."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                   COUNT(m.id) AS meeting_count
            FROM projects p
            LEFT JOIN meetings m ON p.id = m.project_id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/projects", status_code=201)
async def create_project(body: ProjectCreate):
    """Create a new project."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")
    if len(name) > 100:
        raise HTTPException(status_code=400, detail="Project name cannot exceed 100 characters.")

    desc = (body.description or "").strip()
    if len(desc) > 500:
        raise HTTPException(status_code=400, detail="Description cannot exceed 500 characters.")

    now = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (name, desc if desc else None, now, now)
            )
            project_id = cur.lastrowid
            return {
                "id": project_id,
                "name": name,
                "description": desc if desc else None,
                "created_at": now,
                "updated_at": now,
                "meeting_count": 0,
            }
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="A project with this name already exists.")


@app.get("/api/projects/{project_id}")
async def get_project(project_id: int):
    """Get single project detail with meeting_count."""
    with get_db() as conn:
        row = conn.execute("""
            SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                   COUNT(m.id) AS meeting_count
            FROM projects p
            LEFT JOIN meetings m ON p.id = m.project_id
            WHERE p.id = ?
            GROUP BY p.id
        """, (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found.")
        return dict(row)


@app.put("/api/projects/{project_id}")
async def update_project(project_id: int, body: ProjectUpdate):
    """Update a project's name and description."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")
    if len(name) > 100:
        raise HTTPException(status_code=400, detail="Project name cannot exceed 100 characters.")

    desc = (body.description or "").strip()
    if len(desc) > 500:
        raise HTTPException(status_code=400, detail="Description cannot exceed 500 characters.")

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Project not found.")

        # Check duplicate name on another project
        duplicate = conn.execute(
            "SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id != ?",
            (name, project_id)
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=400, detail="A project with this name already exists.")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            (name, desc if desc else None, now, project_id)
        )

        updated = conn.execute("""
            SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                   COUNT(m.id) AS meeting_count
            FROM projects p
            LEFT JOIN meetings m ON p.id = m.project_id
            WHERE p.id = ?
            GROUP BY p.id
        """, (project_id,)).fetchone()
        return dict(updated)


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int):
    """Delete a project and cascade delete all its meetings and associated audio files."""
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Project not found.")

        # Clean up audio files for meetings in this project
        meetings = conn.execute("SELECT audio_file FROM meetings WHERE project_id = ?", (project_id,)).fetchall()
        for m in meetings:
            if m["audio_file"]:
                fpath = AUDIO_DIR / m["audio_file"]
                try:
                    if fpath.exists():
                        fpath.unlink()
                except Exception as e:
                    log.warning(f"Error removing audio file {fpath}: {e}")

        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return {"ok": True, "deleted_id": project_id}


# ── Departments Endpoints ──────────────────────────────────────────

@app.get("/api/departments")
async def list_departments():
    """List departments with member count and member chips."""
    with get_db() as conn:
        dept_rows = conn.execute("""
            SELECT id, name, created_at, updated_at
            FROM departments
            ORDER BY name COLLATE NOCASE ASC
        """).fetchall()

        member_rows = conn.execute("""
            SELECT id, name, department_id
            FROM team_members
            ORDER BY name COLLATE NOCASE ASC
        """).fetchall()

        members_by_dept = {}
        for m in member_rows:
            members_by_dept.setdefault(m["department_id"], []).append({
                "id": m["id"],
                "name": m["name"],
            })

        result = []
        for d in dept_rows:
            d_members = members_by_dept.get(d["id"], [])
            result.append({
                "id": d["id"],
                "name": d["name"],
                "created_at": d["created_at"],
                "updated_at": d["updated_at"],
                "member_count": len(d_members),
                "members": d_members,
            })
        return result


@app.post("/api/departments")
async def create_department(request: Request):
    """Create a new department."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    name = body.get("name")
    if not name or not str(name).strip():
        raise HTTPException(status_code=422, detail="Department name is required")
    name = str(name).strip()
    if len(name) > 60:
        raise HTTPException(status_code=422, detail="Department name must be at most 60 characters")

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM departments WHERE name = ? COLLATE NOCASE", (name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Department '{name}' already exists")

        cur = conn.execute(
            "INSERT INTO departments (name, created_at, updated_at) VALUES (?, ?, ?)",
            (name, now, now)
        )
        dept_id = cur.lastrowid
        return {
            "id": dept_id,
            "name": name,
            "created_at": now,
            "updated_at": now,
            "member_count": 0,
            "members": [],
        }


@app.put("/api/departments/{dept_id}")
async def update_department(dept_id: int, request: Request):
    """Update a department's name."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    name = body.get("name")
    if not name or not str(name).strip():
        raise HTTPException(status_code=422, detail="Department name is required")
    name = str(name).strip()
    if len(name) > 60:
        raise HTTPException(status_code=422, detail="Department name must be at most 60 characters")

    with get_db() as conn:
        dept = conn.execute("SELECT id, name, created_at FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")

        conflict = conn.execute(
            "SELECT id FROM departments WHERE name = ? COLLATE NOCASE AND id != ?",
            (name, dept_id)
        ).fetchone()
        if conflict:
            raise HTTPException(status_code=409, detail=f"Department '{name}' already exists")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE departments SET name = ?, updated_at = ? WHERE id = ?",
            (name, now, dept_id)
        )

        member_rows = conn.execute(
            "SELECT id, name FROM team_members WHERE department_id = ? ORDER BY name COLLATE NOCASE ASC",
            (dept_id,)
        ).fetchall()
        members = [{"id": m["id"], "name": m["name"]} for m in member_rows]

        return {
            "id": dept_id,
            "name": name,
            "created_at": dept["created_at"],
            "updated_at": now,
            "member_count": len(members),
            "members": members,
        }


@app.delete("/api/departments/{dept_id}")
async def delete_department(dept_id: int):
    """Delete a department. Blocked if department still has members."""
    with get_db() as conn:
        dept = conn.execute("SELECT id, name FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")

        member_count = conn.execute(
            "SELECT COUNT(*) FROM team_members WHERE department_id = ?", (dept_id,)
        ).fetchone()[0]

        if member_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Move or remove its {member_count} member{'s' if member_count != 1 else ''} first"
            )

        conn.execute("DELETE FROM departments WHERE id = ?", (dept_id,))
        return {"ok": True, "deleted_id": dept_id}


# ── Team Members Endpoints ─────────────────────────────────────────

@app.get("/api/team-members")
async def list_team_members():
    """List team members with department details and assigned ticket count."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT m.id, m.name, m.department_id, m.created_at, m.updated_at,
                   d.name AS department_name,
                   (SELECT COUNT(*) FROM tickets t WHERE t.assignee_member_id = m.id) AS assigned_ticket_count
            FROM team_members m
            LEFT JOIN departments d ON m.department_id = d.id
            ORDER BY m.name COLLATE NOCASE ASC
        """).fetchall()

        return [
            {
                "id": r["id"],
                "name": r["name"],
                "department_id": r["department_id"],
                "department_name": r["department_name"] or "Unknown",
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "assigned_ticket_count": r["assigned_ticket_count"] or 0,
            }
            for r in rows
        ]


@app.post("/api/team-members")
async def create_team_member(request: Request):
    """Create a new team member."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    name = body.get("name")
    if not name or not str(name).strip():
        raise HTTPException(status_code=422, detail="Member name is required")
    name = str(name).strip()
    if len(name) > 100:
        raise HTTPException(status_code=422, detail="Member name must be at most 100 characters")

    department_id = body.get("department_id")
    if department_id is None:
        raise HTTPException(status_code=422, detail="Department is required")
    try:
        department_id = int(department_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Invalid department ID")

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        dept = conn.execute("SELECT id, name FROM departments WHERE id = ?", (department_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")

        cur = conn.execute(
            "INSERT INTO team_members (name, department_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, department_id, now, now)
        )
        member_id = cur.lastrowid
        return {
            "id": member_id,
            "name": name,
            "department_id": department_id,
            "department_name": dept["name"],
            "created_at": now,
            "updated_at": now,
            "assigned_ticket_count": 0,
        }


@app.put("/api/team-members/{member_id}")
async def update_team_member(member_id: int, request: Request):
    """Update a team member's name or department."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    name = body.get("name")
    if not name or not str(name).strip():
        raise HTTPException(status_code=422, detail="Member name is required")
    name = str(name).strip()
    if len(name) > 100:
        raise HTTPException(status_code=422, detail="Member name must be at most 100 characters")

    department_id = body.get("department_id")
    if department_id is None:
        raise HTTPException(status_code=422, detail="Department is required")
    try:
        department_id = int(department_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Invalid department ID")

    with get_db() as conn:
        member = conn.execute("SELECT id, name, created_at FROM team_members WHERE id = ?", (member_id,)).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Team member not found")

        dept = conn.execute("SELECT id, name FROM departments WHERE id = ?", (department_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE team_members SET name = ?, department_id = ?, updated_at = ? WHERE id = ?",
            (name, department_id, now, member_id)
        )

        # Update tickets assigned to this member with the new spelling
        conn.execute(
            "UPDATE tickets SET assignee = ?, updated_at = ? WHERE assignee_member_id = ?",
            (name, now, member_id)
        )

        ticket_count = conn.execute(
            "SELECT COUNT(*) FROM tickets WHERE assignee_member_id = ?", (member_id,)
        ).fetchone()[0]

        return {
            "id": member_id,
            "name": name,
            "department_id": department_id,
            "department_name": dept["name"],
            "created_at": member["created_at"],
            "updated_at": now,
            "assigned_ticket_count": ticket_count or 0,
        }


@app.delete("/api/team-members/{member_id}")
async def delete_team_member(member_id: int):
    """Delete a team member. Assigned tickets keep their assignee name text and become not on team."""
    with get_db() as conn:
        member = conn.execute("SELECT id, name FROM team_members WHERE id = ?", (member_id,)).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Team member not found")

        ticket_count = conn.execute(
            "SELECT COUNT(*) FROM tickets WHERE assignee_member_id = ?", (member_id,)
        ).fetchone()[0]

        # SQLite foreign key ON DELETE SET NULL clears assignee_member_id, preserving assignee text
        conn.execute("DELETE FROM team_members WHERE id = ?", (member_id,))

        return {
            "ok": True,
            "deleted_id": member_id,
            "assigned_ticket_count": ticket_count or 0,
        }


@app.get("/api/projects/{project_id}/meetings")
async def list_project_meetings(project_id: int):
    """List lightweight meetings for a project, newest first."""
    with get_db() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")

        rows = conn.execute("""
            SELECT m.id, m.project_id, m.created_at, m.input_type, m.whisper_model, m.llm_model,
                   m.transcript,
                   (SELECT COUNT(*) FROM tickets t WHERE t.meeting_id = m.id) AS ticket_count
            FROM meetings m
            WHERE m.project_id = ?
            ORDER BY m.created_at DESC
        """, (project_id,)).fetchall()

        meetings = []
        for r in rows:
            raw_transcript = r["transcript"] or ""
            snippet = raw_transcript[:120] + ("..." if len(raw_transcript) > 120 else "")

            meetings.append({
                "id": r["id"],
                "project_id": r["project_id"],
                "created_at": r["created_at"],
                "input_type": r["input_type"],
                "whisper_model": r["whisper_model"],
                "llm_model": r["llm_model"],
                "ticket_count": r["ticket_count"] or 0,
                "transcript_snippet": snippet,
            })
        return meetings


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: int):
    """Get full meeting details including transcript, tickets from tickets table, and has_audio flag."""
    with get_db() as conn:
        row = conn.execute("""
            SELECT m.id, m.project_id, m.created_at, m.input_type,
                   m.whisper_model, m.llm_model, m.transcript, m.tickets_json,
                   m.audio_file,
                   p.name AS project_name
            FROM meetings m
            LEFT JOIN projects p ON m.project_id = p.id
            WHERE m.id = ?
        """, (meeting_id,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Meeting not found.")

        # Read tickets from the tickets table ordered by position
        ticket_rows = conn.execute("""
            SELECT t.id, t.meeting_id, t.position, t.title, t.description,
                   t.assignee, t.assignee_member_id, t.priority, t.acceptance_criteria, t.status,
                   t.created_at, t.updated_at,
                   m.name AS member_name,
                   d.name AS department_name
            FROM tickets t
            LEFT JOIN team_members m ON t.assignee_member_id = m.id
            LEFT JOIN departments d ON m.department_id = d.id
            WHERE t.meeting_id = ?
            ORDER BY t.position ASC, t.id ASC
        """, (meeting_id,)).fetchall()

        tickets = []
        for tr in ticket_rows:
            try:
                ac_list = json.loads(tr["acceptance_criteria"]) if tr["acceptance_criteria"] else []
            except Exception:
                ac_list = []

            mem_id = tr["assignee_member_id"]
            if mem_id and tr["member_name"]:
                display_name = tr["member_name"]
                dept_name = tr["department_name"]
                on_team = True
            elif tr["assignee"]:
                display_name = tr["assignee"]
                mem_id = None
                dept_name = None
                on_team = False
            else:
                display_name = None
                mem_id = None
                dept_name = None
                on_team = False

            tickets.append({
                "id": tr["id"],
                "meeting_id": tr["meeting_id"],
                "position": tr["position"],
                "title": tr["title"],
                "description": tr["description"] or "",
                "assignee": {
                    "name": display_name,
                    "member_id": mem_id,
                    "department": dept_name,
                    "on_team": on_team,
                } if display_name else None,
                "priority": tr["priority"],
                "acceptance_criteria": ac_list,
                "status": tr["status"],
                "created_at": tr["created_at"],
                "updated_at": tr["updated_at"],
            })

        audio_file = row["audio_file"]
        has_audio = bool(audio_file and (AUDIO_DIR / audio_file).is_file())

        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "project_name": row["project_name"] or f"Project #{row['project_id']}",
            "created_at": row["created_at"],
            "input_type": row["input_type"],
            "whisper_model": row["whisper_model"],
            "llm_model": row["llm_model"],
            "transcript": row["transcript"] or "",
            "tickets": tickets,
            "has_audio": has_audio,
        }


@app.api_route("/api/meetings/{meeting_id}/audio", methods=["GET", "HEAD"])
async def get_meeting_audio(meeting_id: int):
    """Stream saved audio file with HTTP Range support for scrubbing."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT audio_file FROM meetings WHERE id = ?",
            (meeting_id,)
        ).fetchone()

        if not row or not row["audio_file"]:
            raise HTTPException(status_code=404, detail="Audio file not found for this meeting.")

        file_path = AUDIO_DIR / row["audio_file"]
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail="Audio file does not exist on disk.")

        media_type, _ = mimetypes.guess_type(str(file_path))
        if not media_type:
            media_type = "application/octet-stream"

        return FileResponse(
            path=str(file_path),
            media_type=media_type,
            content_disposition_type="inline"
        )


# ── Ticket Endpoints ──────────────────────────────────────────────

@app.put("/api/tickets/{ticket_id}")
async def update_ticket(ticket_id: int, request: Request):
    """Update editable ticket fields with server-side validation, team member linking, and reset-to-pending rule."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    allowed_fields = {
        "title", "description", "priority", "acceptance_criteria",
        "assignee_member_id", "assignee_name", "assignee"
    }
    extra_fields = set(body.keys()) - allowed_fields
    if extra_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown fields not allowed: {', '.join(sorted(extra_fields))}"
        )

    errors = {}
    title = body.get("title")
    if title is None or not str(title).strip():
        errors["title"] = "Title is required"
    elif len(str(title).strip()) > 200:
        errors["title"] = "Title must be at most 200 characters"
    else:
        title = str(title).strip()

    desc = body.get("description", "")
    if desc is None:
        desc = ""
    elif not isinstance(desc, str):
        errors["description"] = "Description must be text"
    elif len(desc) > 2000:
        errors["description"] = "Description must be at most 2000 characters"

    priority = body.get("priority")
    if not priority or str(priority).lower() not in ("low", "medium", "high"):
        errors["priority"] = "Priority must be 'low', 'medium', or 'high'"
    else:
        priority = str(priority).lower()

    raw_ac = body.get("acceptance_criteria")
    if raw_ac is None:
        ac_list = []
    elif not isinstance(raw_ac, list):
        errors["acceptance_criteria"] = "Acceptance criteria must be a list of strings"
    else:
        clean_ac = [str(item).strip() for item in raw_ac if item is not None and str(item).strip()]
        if len(clean_ac) > 20:
            errors["acceptance_criteria"] = "At most 20 acceptance criteria allowed"
        else:
            for item in clean_ac:
                if len(item) > 300:
                    errors["acceptance_criteria"] = "Each criterion must be at most 300 characters"
                    break
        ac_list = clean_ac

    # Assignee handling:
    # If a member id is given, the server sets the name from that member and ignores any text;
    # if not, the text is stored as the not-on-team name. Reject an unknown member id with a clear error.
    raw_member_id = body.get("assignee_member_id")
    raw_text = body.get("assignee_name")
    if raw_text is None:
        raw_text = body.get("assignee")

    target_member_id = None
    target_assignee_name = None
    target_dept_name = None
    target_on_team = False

    if raw_member_id is not None and str(raw_member_id).strip() != "":
        try:
            target_member_id = int(raw_member_id)
        except (ValueError, TypeError):
            errors["assignee_member_id"] = "Invalid member ID"
    else:
        if raw_text is not None and str(raw_text).strip():
            clean_txt = str(raw_text).strip()
            if clean_txt.startswith("@"):
                clean_txt = clean_txt[1:].strip()
            if len(clean_txt) > 100:
                errors["assignee_name"] = "Assignee name must be at most 100 characters"
            else:
                target_assignee_name = clean_txt
        else:
            target_assignee_name = None

    if errors:
        return JSONResponse(status_code=422, content={"detail": "Validation error", "errors": errors})

    with get_db() as conn:
        current = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Ticket not found")

        if target_member_id is not None:
            mem = conn.execute("""
                SELECT m.id, m.name, d.name AS department_name
                FROM team_members m
                LEFT JOIN departments d ON m.department_id = d.id
                WHERE m.id = ?
            """, (target_member_id,)).fetchone()
            if not mem:
                raise HTTPException(status_code=404, detail="Team member not found")
            target_assignee_name = mem["name"]
            target_dept_name = mem["department_name"]
            target_on_team = True

        try:
            curr_ac = json.loads(current["acceptance_criteria"]) if current["acceptance_criteria"] else []
        except Exception:
            curr_ac = []

        curr_title = current["title"] or ""
        curr_desc = current["description"] or ""
        curr_priority = current["priority"] or ""
        curr_assignee = current["assignee"] or ""
        curr_member_id = current["assignee_member_id"]

        new_assignee_str = target_assignee_name or ""

        content_changed = (
            curr_title != title or
            curr_desc != desc or
            curr_priority != priority or
            curr_ac != ac_list or
            curr_assignee != new_assignee_str or
            curr_member_id != target_member_id
        )

        new_status = current["status"]
        if content_changed and current["status"] == "approved":
            new_status = "pending"

        now = datetime.now(timezone.utc).isoformat()
        conn.execute("""
            UPDATE tickets
            SET title = ?, description = ?, assignee = ?, assignee_member_id = ?,
                priority = ?, acceptance_criteria = ?, status = ?, updated_at = ?
            WHERE id = ?
        """, (title, desc, target_assignee_name, target_member_id, priority, json.dumps(ac_list), new_status, now, ticket_id))

        return {
            "id": ticket_id,
            "meeting_id": current["meeting_id"],
            "position": current["position"],
            "title": title,
            "description": desc,
            "assignee": {
                "name": target_assignee_name,
                "member_id": target_member_id,
                "department": target_dept_name,
                "on_team": target_on_team,
            } if target_assignee_name else None,
            "priority": priority,
            "acceptance_criteria": ac_list,
            "status": new_status,
            "created_at": current["created_at"],
            "updated_at": now,
        }


@app.put("/api/tickets/{ticket_id}/status")
async def update_ticket_status(ticket_id: int, request: Request):
    """Set ticket status to 'approved' or 'pending'."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    new_status = body.get("status")
    if new_status not in ("approved", "pending"):
        raise HTTPException(status_code=422, detail="Status must be 'approved' or 'pending'")

    with get_db() as conn:
        current = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Ticket not found")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, ticket_id)
        )

        row = conn.execute("""
            SELECT t.id, t.meeting_id, t.position, t.title, t.description,
                   t.assignee, t.assignee_member_id, t.priority, t.acceptance_criteria, t.status,
                   t.created_at, t.updated_at,
                   m.name AS member_name,
                   d.name AS department_name
            FROM tickets t
            LEFT JOIN team_members m ON t.assignee_member_id = m.id
            LEFT JOIN departments d ON m.department_id = d.id
            WHERE t.id = ?
        """, (ticket_id,)).fetchone()

        try:
            ac_list = json.loads(row["acceptance_criteria"]) if row["acceptance_criteria"] else []
        except Exception:
            ac_list = []

        mem_id = row["assignee_member_id"]
        if mem_id and row["member_name"]:
            disp_name = row["member_name"]
            dept = row["department_name"]
            on_team = True
        elif row["assignee"]:
            disp_name = row["assignee"]
            mem_id = None
            dept = None
            on_team = False
        else:
            disp_name = None
            mem_id = None
            dept = None
            on_team = False

        return {
            "id": row["id"],
            "meeting_id": row["meeting_id"],
            "position": row["position"],
            "title": row["title"],
            "description": row["description"] or "",
            "assignee": {
                "name": disp_name,
                "member_id": mem_id,
                "department": dept,
                "on_team": on_team,
            } if disp_name else None,
            "priority": row["priority"],
            "acceptance_criteria": ac_list,
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


@app.get("/api/health")
async def health():
    """Environment info for the diagnostics panel."""
    return {
        "status": "ok",
        "backend": BACKEND,
        "gpu_name": GPU_NAME,
        "vram": get_vram_info(),
        "whisper_server": whisper_srv.info(),
        "llama_server": llama_srv.info(),
    }


@app.get("/api/models")
async def list_models():
    """All registered models with availability and currently loaded info."""
    return {
        "models": model_availability(),
        "loaded_whisper": whisper_srv.model_id,
        "loaded_llm": llama_srv.model_id,
    }


@app.post("/api/models/select")
async def select_model(body: dict):
    """Switch a server to a different model. Body: {model_id: str}."""
    model_id = body.get("model_id")
    m = get_model(model_id)
    if not m:
        raise HTTPException(404, f"Unknown model: {model_id}")
    if not os.path.isfile(m["path"]):
        raise HTTPException(400, f"Model file not found: {m['path']}")

    srv = whisper_srv if m["type"] == "whisper" else llama_srv

    # Already loaded?
    if srv.model_id == model_id and srv.status == "up":
        return {"message": "Already loaded", **srv.info()}

    prev_model_id = srv.model_id
    try:
        await srv.start(m)
        return {"message": "Model loaded", **srv.info()}
    except Exception as e:
        # Try to fall back to previous model
        if prev_model_id and prev_model_id != model_id:
            prev = get_model(prev_model_id)
            if prev:
                try:
                    await srv.start(prev)
                except Exception:
                    pass  # double failure, server stays down
        raise HTTPException(500, f"Failed to load {m['name']}: {e}")


# ── SSE stream for job events ─────────────────────────────────────

@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    """Server-Sent Events stream for a job's diagnostics."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    q = job.subscribe()

    async def event_stream():
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(evt, default=str)}\n\n"
                    # If this is a terminal event, close the stream
                    if evt.get("stage") == "done" or evt.get("status") == "failed":
                        if evt.get("stage") == "done":
                            break
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield f": keepalive\n\n"
        finally:
            job.unsubscribe(q)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Audio conversion ──────────────────────────────────────────────

async def convert_audio(input_path: Path, job: Job) -> tuple[Path, float]:
    """Convert audio to 16kHz mono WAV. Returns (wav_path, duration_seconds)."""
    out_path = input_path.parent / f"{input_path.stem}_converted.wav"
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-ar", "16000", "-ac", "1", "-f", "wav",
        str(out_path),
    ]
    job.emit("audio_conversion", "running", cmd=" ".join(cmd))
    t0 = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    elapsed = round(time.monotonic() - t0, 2)

    if proc.returncode != 0:
        err = stderr.decode(errors="replace")[-1000:]
        job.emit("audio_conversion", "failed", error=err, elapsed_s=elapsed)
        raise RuntimeError(f"ffmpeg failed: {err}")

    # Parse duration from ffmpeg output
    duration = 0.0
    for line in stderr.decode(errors="replace").splitlines():
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", line)
        if m:
            h, mi, s, cs = int(m[1]), int(m[2]), int(m[3]), int(m[4])
            duration = h * 3600 + mi * 60 + s + cs / 100
            break

    job.emit("audio_conversion", "done",
             elapsed_s=elapsed, duration_s=round(duration, 1), output_format="16kHz mono WAV")
    return out_path, duration


# ── Whisper transcription ─────────────────────────────────────────

async def transcribe(wav_path: Path, job: Job) -> str:
    """Send WAV to whisper-server and return the text."""
    if whisper_srv.status != "up":
        job.emit("transcription", "failed", error="Whisper server not running")
        raise RuntimeError("Whisper server not running")

    job.emit("transcription", "running",
             model=whisper_srv.model_id, backend=BACKEND, gpu=GPU_NAME)
    t0 = time.monotonic()

    url = f"{whisper_srv.base_url}/inference"
    async with httpx.AsyncClient(timeout=600) as client:
        with open(wav_path, "rb") as f:
            files = {"file": ("audio.wav", f, "audio/wav")}
            data = {"response_format": "json", "temperature": "0.0"}
            try:
                r = await client.post(url, files=files, data=data)
                r.raise_for_status()
            except Exception as e:
                elapsed = round(time.monotonic() - t0, 2)
                job.emit("transcription", "failed", error=str(e), elapsed_s=elapsed)
                raise

    elapsed = round(time.monotonic() - t0, 2)
    result = r.json()
    text = result.get("text", "").strip()
    word_count = len(text.split())

    # Speed as multiple of real-time
    # Try to get the audio duration from the job events
    audio_dur = None
    for evt in job.events:
        if evt.get("stage") == "audio_conversion" and evt.get("duration_s"):
            audio_dur = evt["duration_s"]
            break

    speed_str = ""
    if audio_dur and audio_dur > 0 and elapsed > 0:
        speed = audio_dur / elapsed
        speed_str = f"{speed:.1f}x real-time"

    job.emit("transcription", "done",
             elapsed_s=elapsed, word_count=word_count, speed=speed_str,
             model=whisper_srv.model_id, backend=BACKEND, gpu=GPU_NAME)
    return text


# ── Text chunking ─────────────────────────────────────────────────

def chunk_text(text: str, max_chars: int = 6000) -> list[str]:
    """Split text at paragraph boundaries if too long."""
    if len(text) <= max_chars:
        return [text]
    paragraphs = text.split("\n\n")
    chunks = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > max_chars and current:
            chunks.append(current.strip())
            current = para
        else:
            current = current + "\n\n" + para if current else para
    if current.strip():
        chunks.append(current.strip())
    return chunks if chunks else [text]


# ── LLM ticket extraction ────────────────────────────────────────

# JSON schema for constrained output
TICKET_SCHEMA = {
    "type": "object",
    "properties": {
        "tickets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "assignee": {"type": ["string", "null"]},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "description", "assignee", "priority", "acceptance_criteria"],
            },
        }
    },
    "required": ["tickets"],
}


async def extract_tickets(text: str, job: Job) -> list[dict]:
    """Call LLM server to extract tickets from text."""
    if llama_srv.status != "up":
        job.emit("ticket_extraction", "failed", error="LLM server not running")
        raise RuntimeError("LLM server not running")

    model_cfg = get_model(llama_srv.model_id) or {}
    ollama_name = model_cfg.get("ollama_name")

    chunks = chunk_text(text)
    total_chunks = len(chunks)
    all_tickets = []

    job.emit("ticket_extraction", "running",
             model=llama_srv.model_id, total_chunks=total_chunks)

    system_prompt = get_system_prompt()

    for i, chunk in enumerate(chunks):
        chunk_label = f"chunk {i+1}/{total_chunks}"
        job.emit("ticket_extraction", "running",
                 detail=f"Processing {chunk_label}", chunk=chunk_label,
                 model=llama_srv.model_id)

        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                if ollama_name:
                    # Native local Ollama API with Vulkan GPU offloading and disabled thinking
                    url = "http://127.0.0.1:11434/api/chat"
                    payload = {
                        "model": ollama_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Extract tickets from these meeting notes:\n\n{chunk}"},
                        ],
                        "stream": False,
                        "think": False,
                        "format": TICKET_SCHEMA,
                        "options": {"temperature": 0.1},
                    }
                    r = await client.post(url, json=payload)
                    r.raise_for_status()
                    result = r.json()
                    content = result.get("message", {}).get("content", "")
                    prompt_tokens = result.get("prompt_eval_count", 0)
                    completion_tokens = result.get("eval_count", 0)
                else:
                    url = f"{llama_srv.base_url}/v1/chat/completions"
                    payload = {
                        "model": "local",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Extract tickets from these meeting notes:\n\n{chunk}"},
                        ],
                        "temperature": 0.1,
                        "response_format": {
                            "type": "json_schema",
                            "json_schema": {
                                "name": "ticket_list",
                                "strict": True,
                                "schema": TICKET_SCHEMA,
                            },
                        },
                    }
                    r = await client.post(url, json=payload)
                    r.raise_for_status()
                    result = r.json()
                    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                    usage = result.get("usage", {})
                    prompt_tokens = usage.get("prompt_tokens", 0)
                    completion_tokens = usage.get("completion_tokens", 0)
        except Exception as e:
            elapsed = round(time.monotonic() - t0, 2)
            job.emit("ticket_extraction", "failed",
                     error=f"LLM request failed ({chunk_label}): {e}", elapsed_s=elapsed)
            raise

        elapsed = round(time.monotonic() - t0, 2)
        tps = round(completion_tokens / elapsed, 1) if elapsed > 0 else 0

        job.emit("ticket_extraction", "running",
                 detail=f"Finished {chunk_label}",
                 chunk=chunk_label,
                 elapsed_s=elapsed,
                 prompt_tokens=prompt_tokens,
                 completion_tokens=completion_tokens,
                 tokens_per_second=tps)

        # Parse JSON
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and "tickets" in parsed:
                tickets = parsed["tickets"]
            elif isinstance(parsed, list):
                tickets = parsed
            else:
                tickets = [parsed]
            all_tickets.extend(tickets)
        except json.JSONDecodeError as e:
            job.emit("validation", "failed",
                     error=f"JSON parse error: {e}", raw_output=content[:2000])
            raise RuntimeError(f"LLM output was not valid JSON: {e}\nRaw: {content[:500]}")

    job.emit("ticket_extraction", "done",
             model=llama_srv.model_id, total_tickets=len(all_tickets),
             total_chunks=total_chunks)
    return all_tickets


# ── Full pipeline ─────────────────────────────────────────────────

async def run_pipeline(job: Job, text: Optional[str], audio_path: Optional[Path],
                       audio_filename: Optional[str], audio_size: Optional[int],
                       project_id: int):
    """Run the full ticket extraction pipeline and save meeting to project."""
    t0 = time.monotonic()
    transcript = text or ""

    try:
        # Stage 1: input received
        if audio_path:
            job.emit("input_received", "done",
                     input_type="audio", filename=audio_filename,
                     file_size_kb=round(audio_size / 1024, 1) if audio_size else None)
        else:
            job.emit("input_received", "done",
                     input_type="text", text_length=len(transcript))

        # Stage 2: audio conversion (if audio)
        audio_duration = None
        if audio_path:
            wav_path, audio_duration = await convert_audio(audio_path, job)
        else:
            job.emit("audio_conversion", "skipped")

        # Stage 3: transcription (if audio)
        if audio_path:
            transcript = await transcribe(wav_path, job)
        else:
            job.emit("transcription", "skipped")

        if not transcript.strip():
            job.emit("done", "failed", error="No text to process (empty transcript or input)")
            return

        # Stage 4: ticket extraction
        tickets = await extract_tickets(transcript, job)

        # Automatic matching of model's names to team members (runs once per job with 1 DB query)
        match_t0 = time.monotonic()
        with get_db() as conn:
            member_rows = conn.execute("""
                SELECT m.id, m.name, d.name AS department_name
                FROM team_members m
                LEFT JOIN departments d ON m.department_id = d.id
            """).fetchall()
            team_refs = [TeamMemberRef(r["id"], r["name"], r["department_name"] or "") for r in member_rows]

        matched_count = 0
        named_count = 0
        non_exact_pairs = []

        for t in tickets:
            raw_assignee = t.get("assignee")
            if raw_assignee and str(raw_assignee).strip():
                named_count += 1
                matched_member, is_exact = match_assignee(str(raw_assignee), team_refs)
                if matched_member:
                    matched_count += 1
                    t["assignee_member_id"] = matched_member.id
                    t["assignee_department"] = matched_member.department_name
                    if not is_exact:
                        non_exact_pairs.append(f"{str(raw_assignee).strip()} -> {matched_member.name}")
                    # Use member's database spelling
                    t["assignee"] = matched_member.name
                else:
                    t["assignee_member_id"] = None
                    t["assignee_department"] = None
            else:
                t["assignee"] = None
                t["assignee_member_id"] = None
                t["assignee_department"] = None

        match_ms = round((time.monotonic() - match_t0) * 1000, 2)
        match_detail = f"Matched {matched_count}/{named_count} assignees in {match_ms}ms"
        if non_exact_pairs:
            match_detail += f" ({', '.join(non_exact_pairs)})"

        log.info(f"Assignee matching: {match_detail}")
        if match_ms > 50:
            log.warning(f"Assignee matching took longer than 50ms: {match_ms}ms")

        # Stage 5: validation
        job.emit("validation", "done", ticket_count=len(tickets), assignee_matching=match_detail)

        # Stage 6: done
        total = round(time.monotonic() - t0, 2)
        # Build per-stage timing summary
        stage_times = {}
        for evt in job.events:
            s = evt.get("stage", "")
            if evt.get("elapsed_s") is not None:
                stage_times[s] = evt["elapsed_s"]

        # Save meeting row to database
        saved_meeting_id = None
        save_error = None
        saved_audio_filename = None
        saved_tickets = []
        try:
            now = datetime.now(timezone.utc).isoformat()
            input_type = "audio" if audio_path else "text"
            whisper_mod = whisper_srv.model_id
            llm_mod = llama_srv.model_id
            tickets_json_str = json.dumps(tickets)

            with get_db() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO meetings (
                        project_id, created_at, input_type,
                        transcript, tickets_json, whisper_model, llm_model
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (project_id, now, input_type, transcript, tickets_json_str, whisper_mod, llm_mod)
                )
                saved_meeting_id = cur.lastrowid

                # Insert tickets in the same database transaction as the meeting row
                for pos, t in enumerate(tickets):
                    title = str(t.get("title") or "Untitled Ticket").strip()
                    desc = str(t.get("description") or "")
                    assignee = t.get("assignee")
                    if assignee:
                        assignee = str(assignee).strip()
                    member_id = t.get("assignee_member_id")
                    priority = str(t.get("priority") or "medium").lower()
                    if priority not in ("low", "medium", "high"):
                        priority = "medium"
                    ac = t.get("acceptance_criteria") or []
                    if not isinstance(ac, list):
                        ac = []
                    ac_json = json.dumps(ac)
                    status = "pending"

                    t_cur = conn.execute(
                        """
                        INSERT INTO tickets (
                            meeting_id, position, title, description, assignee,
                            priority, acceptance_criteria, status, assignee_member_id,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (saved_meeting_id, pos, title, desc, assignee, priority, ac_json, status, member_id, now, now)
                    )
                    saved_tickets.append({
                        "id": t_cur.lastrowid,
                        "meeting_id": saved_meeting_id,
                        "position": pos,
                        "title": title,
                        "description": desc,
                        "assignee": {
                            "name": assignee,
                            "member_id": member_id,
                            "department": t.get("assignee_department"),
                            "on_team": bool(member_id),
                        } if assignee else None,
                        "priority": priority,
                        "acceptance_criteria": ac,
                        "status": status,
                        "created_at": now,
                        "updated_at": now,
                    })

                log.info(f"Saved meeting {saved_meeting_id} with {len(saved_tickets)} tickets under project {project_id}")

            # If audio input, save the original uploaded file to data/audio/
            if audio_path and saved_meeting_id:
                try:
                    ext = Path(audio_filename).suffix.lower() if audio_filename else ".wav"
                    ext = re.sub(r"[^a-zA-Z0-9.]", "", ext)[:10] or ".wav"
                    if not ext.startswith("."):
                        ext = f".{ext}"
                    saved_audio_filename = f"meeting_{saved_meeting_id}{ext}"
                    dest_path = AUDIO_DIR / saved_audio_filename
                    shutil.copy2(audio_path, dest_path)

                    with get_db() as conn:
                        conn.execute(
                            "UPDATE meetings SET audio_file = ? WHERE id = ?",
                            (saved_audio_filename, saved_meeting_id)
                        )
                    log.info(f"Saved audio for meeting {saved_meeting_id} to {dest_path}")
                except Exception as audio_err:
                    log.error(f"Failed to save audio file for meeting {saved_meeting_id}: {audio_err}")
                    save_error = f"Audio saving failed: {audio_err}"

        except Exception as db_err:
            log.error(f"Failed to save meeting to DB: {db_err}")
            save_error = str(db_err)

        job.emit("done", "done",
                 total_elapsed_s=total,
                 stage_times=stage_times,
                 tickets=saved_tickets if saved_meeting_id else tickets,
                 transcript=transcript,
                 meeting_id=saved_meeting_id,
                 save_error=save_error)

    except Exception as e:
        total = round(time.monotonic() - t0, 2)
        job.emit("done", "failed", error=str(e), total_elapsed_s=total)


# ── POST /api/jobs — create a new job ─────────────────────────────

@app.post("/api/jobs")
async def create_job(
    project_id: int = Form(...),
    text: Optional[str] = Form(None),
    audio: Optional[UploadFile] = File(None),
):
    """Create a ticket extraction job. Requires valid project_id."""
    with get_db() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(400, f"Project with ID {project_id} does not exist.")

    if not text and not audio:
        raise HTTPException(400, "Provide either 'text' or 'audio'")

    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id)
    JOBS[job_id] = job

    audio_path = None
    audio_filename = None
    audio_size = None

    if audio and audio.filename:
        # Save uploaded audio
        audio_filename = audio.filename
        audio_path = UPLOAD_DIR / f"{job_id}_{audio.filename}"
        content = await audio.read()
        audio_size = len(content)
        audio_path.write_bytes(content)
        text = None  # audio takes priority

    # Run pipeline in background
    asyncio.create_task(run_pipeline(job, text, audio_path, audio_filename, audio_size, project_id))

    return {"job_id": job_id}


# ── Simple endpoints for curl testing ─────────────────────────────

@app.post("/api/transcribe")
async def transcribe_endpoint(audio: UploadFile = File(...)):
    """Transcribe audio — simple endpoint. Returns transcript + job events."""
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id)
    JOBS[job_id] = job

    # Save file
    audio_path = UPLOAD_DIR / f"{job_id}_{audio.filename}"
    content = await audio.read()
    audio_path.write_bytes(content)

    job.emit("input_received", "done",
             input_type="audio", filename=audio.filename,
             file_size_kb=round(len(content) / 1024, 1))

    wav_path, duration = await convert_audio(audio_path, job)
    text = await transcribe(wav_path, job)

    return {"job_id": job_id, "transcript": text, "events": job.events}


@app.post("/api/tickets")
async def tickets_endpoint(body: dict):
    """Extract tickets from text — simple endpoint for curl testing."""
    text = body.get("text", "")
    if not text:
        raise HTTPException(400, "Provide 'text' in request body")

    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id)
    JOBS[job_id] = job

    job.emit("input_received", "done", input_type="text", text_length=len(text))
    job.emit("audio_conversion", "skipped")
    job.emit("transcription", "skipped")

    tickets = await extract_tickets(text, job)
    job.emit("validation", "done", ticket_count=len(tickets))

    return {"job_id": job_id, "tickets": tickets, "events": job.events}


# ── Startup / shutdown hooks ──────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Start both servers with default models."""
    # Start whisper
    w_model = get_model(CFG["default_whisper"])
    if w_model and os.path.isfile(w_model["path"]):
        try:
            await whisper_srv.start(w_model)
        except Exception as e:
            log.error(f"Whisper startup failed: {e}")
    else:
        log.warning(f"Default whisper model not found: {CFG['default_whisper']}")

    # Start llama
    l_model = get_model(CFG["default_llm"])
    if l_model and os.path.isfile(l_model["path"]):
        try:
            await llama_srv.start(l_model)
        except Exception as e:
            log.error(f"LLM startup failed: {e}")
    else:
        log.warning(f"Default LLM model not found: {CFG['default_llm']}")


@app.on_event("shutdown")
async def shutdown():
    """Stop both servers."""
    await whisper_srv.stop()
    await llama_srv.stop()

