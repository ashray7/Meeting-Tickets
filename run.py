#!/usr/bin/env python3
"""Meeting Tickets — single entry point.

Starts whisper-server and llama-server for the default models,
then starts the FastAPI app. Shuts everything down on Ctrl+C.
"""

import subprocess
import sys
import os

def main():
    # Ensure we're in the project directory
    project_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_dir)

    print("=" * 60)
    print("  Meeting Tickets — starting up")
    print("=" * 60)

    # Run the FastAPI app with uvicorn
    # The app's startup hook handles launching whisper-server and llama-server
    try:
        subprocess.run(
            [
                sys.executable, "-m", "uvicorn",
                "app.main:app",
                "--host", "127.0.0.1",
                "--port", "8000",
                "--log-level", "info",
            ],
            cwd=project_dir,
        )
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()

