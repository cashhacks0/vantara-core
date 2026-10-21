"""Generated output gallery and file serving."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(tags=["outputs"])


@router.get("/outputs")
def list_outputs(request: Request, limit: int = 100):
    rows = request.app.state.db.query(
        "SELECT * FROM outputs ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 500)),)
    )
    for row in rows:
        row["meta"] = json.loads(row.pop("meta_json") or "{}")
        row["url"] = f"/api/outputs/{row['id']}/file"
        row["exists"] = Path(row["path"]).exists()
    return {"outputs": rows}


@router.get("/outputs/{output_id}/file")
def output_file(output_id: str, request: Request):
    row = request.app.state.db.query_one("SELECT * FROM outputs WHERE id = ?", (output_id,))
    if not row:
        raise HTTPException(404, "Output not found")
    path = Path(row["path"]).resolve()
    outputs_dir = request.app.state.settings.outputs_dir.resolve()
    uploads_dir = request.app.state.settings.uploads_dir.resolve()
    if outputs_dir not in path.parents and uploads_dir not in path.parents:
        raise HTTPException(403, "Output path is outside the allowed directories")
    if not path.exists():
        raise HTTPException(404, "Output file is missing from disk")
    return FileResponse(path, media_type=row.get("mime") or "application/octet-stream", filename=row["name"])


@router.delete("/outputs/{output_id}", status_code=204)
def delete_output(output_id: str, request: Request):
    db = request.app.state.db
    row = db.query_one("SELECT * FROM outputs WHERE id = ?", (output_id,))
    if not row:
        raise HTTPException(404, "Output not found")
    path = Path(row["path"]).resolve()
    if request.app.state.settings.outputs_dir.resolve() in path.parents and path.exists():
        path.unlink(missing_ok=True)
    db.execute("DELETE FROM outputs WHERE id = ?", (output_id,))
