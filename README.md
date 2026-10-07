# Meeting Tickets

Upload audio or paste meeting notes → get structured ticket drafts, fully local.

## Prerequisites

- **Python 3.10+** with pip
- **ffmpeg** (for audio conversion)
- **whisper-server** (whisper.cpp) — already installed at `~/.local/bin/whisper-server`
- **llama-server** (llama.cpp) — using Ollama's build at `/usr/local/lib/ollama/llama-server`
- Whisper models (ggml) in `~/.cache/clipforge/whisper.cpp/`
- LLM models via Ollama (Qwen3 4B, Qwen3 8B, Llama 3.2 3B)

## Setup

```bash
# 1. Install Python dependencies
pip install fastapi uvicorn httpx pyyaml python-multipart

# 2. Stop Ollama (it competes for GPU memory)
sudo systemctl stop ollama

# 3. Edit config.yaml if your paths differ

# 4. Run
python3 run.py
```

Open **http://127.0.0.1:8000** in your browser.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Environment info (GPU, server status) |
| `/api/models` | GET | Model registry with availability |
| `/api/models/select` | POST | Switch model `{"model_id": "..."}` |
| `/api/jobs` | POST | Create job (form: `text` or `audio` file) |
| `/api/jobs/{id}/events` | GET | SSE event stream for job diagnostics |
| `/api/transcribe` | POST | Simple transcription (audio file) |
| `/api/tickets` | POST | Simple extraction `{"text": "..."}` |

## Project Structure

```
MeetingTickets/
├── run.py              # Entry point — starts everything
├── config.yaml         # Model registry, ports, GPU backend
├── app/
│   ├── __init__.py
│   └── main.py         # FastAPI app + server management
├── prompts/
│   └── tickets.txt     # System prompt for ticket extraction
├── static/
│   └── index.html      # Single-page UI
└── README.md
```

