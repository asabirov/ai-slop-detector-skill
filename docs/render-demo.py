"""Render actual CLI output from synthetic fixtures as a README image."""
import html
from pathlib import Path
import subprocess
import textwrap

root = Path(__file__).resolve().parents[1]
lines = []
for fixture, expected in [("slop.md", 1), ("clean.md", 0)]:
    command = ["node", "bin/slop-detector.js", f"fixtures/{fixture}", "--level", "1"]
    result = subprocess.run(command, cwd=root, capture_output=True, text=True)
    if result.returncode != expected:
        raise SystemExit(f"Unexpected demo exit code: {result.returncode}")
    lines.append("$ " + " ".join(command))
    for line in result.stdout.strip().splitlines():
        lines.extend(textwrap.wrap(line, width=84, subsequent_indent="      ") or [""])
    lines.extend([f"Exit code: {result.returncode}", ""])
height = 36 + len(lines) * 23
print(f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="{height}" viewBox="0 0 1080 {height}" role="img" aria-labelledby="title">')
print('<title id="title">Actual CLI output: a chatbot greeting fails; clean prose passes.</title>')
print(f'<rect width="1080" height="{height}" fill="#101820"/>')
for index, line in enumerate(lines):
    color = "#9cddc4" if line.startswith("$") else "#f0f3f5"
    print(f'<text x="24" y="{32 + index * 23}" fill="{color}" font-family="monospace" font-size="18" xml:space="preserve">{html.escape(line)}</text>')
print('</svg>')
