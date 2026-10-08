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
        """)
        # Migration: check if audio_file column exists on existing databases
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(meetings)").fetchall()]
        if "audio_file" not in columns:
            conn.execute("ALTER TABLE meetings ADD COLUMN audio_file TEXT;")
            log.info("Migrated meetings table: added audio_file column")
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


@app.get("/api/projects/{project_id}/meetings")
async def list_project_meetings(project_id: int):
    """List lightweight meetings for a project, newest first."""
    with get_db() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")

        rows = conn.execute("""
            SELECT id, project_id, created_at, input_type, whisper_model, llm_model,
                   transcript, tickets_json
            FROM meetings
            WHERE project_id = ?
            ORDER BY created_at DESC
        """, (project_id,)).fetchall()

        meetings = []
        for r in rows:
            raw_transcript = r["transcript"] or ""
            snippet = raw_transcript[:120] + ("..." if len(raw_transcript) > 120 else "")

            try:
                tickets_data = json.loads(r["tickets_json"]) if r["tickets_json"] else []
                ticket_count = len(tickets_data) if isinstance(tickets_data, list) else 0
            except Exception:
                ticket_count = 0

            meetings.append({
                "id": r["id"],
                "project_id": r["project_id"],
                "created_at": r["created_at"],
                "input_type": r["input_type"],
                "whisper_model": r["whisper_model"],
                "llm_model": r["llm_model"],
                "ticket_count": ticket_count,
                "transcript_snippet": snippet,
            })
        return meetings


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: int):
    """Get full meeting details including transcript, tickets, and has_audio flag."""
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

        try:
            tickets = json.loads(row["tickets_json"]) if row["tickets_json"] else []
        except Exception:
            tickets = []

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

        # Stage 5: validation
        job.emit("validation", "done", ticket_count=len(tickets))

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
                log.info(f"Saved meeting {saved_meeting_id} under project {project_id}")

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
                 tickets=tickets,
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

