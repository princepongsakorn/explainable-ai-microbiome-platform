"""Acquire and identify the exact upstream data used by this experiment."""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path


SHAPMAT_URL = "https://github.com/ryzary/shapmat.git"
PAPER_URL = "https://github.com/ryzary/shapmat_paper.git"
SHAPMAT_BRANCH = "cv_notebook"
SHAPMAT_COMMIT = "0ca51a9ab9c859fac3305f599a81b2e2206bef49"
PAPER_COMMIT = "6600175db5984a07b86f2b5591114f39181ff4dc"


@dataclass(frozen=True)
class UpstreamSource:
    data_path: Path
    shapmat_commit: str
    paper_commit: str
    sha256: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _git(*args: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def git_commit(path: Path) -> str:
    return _git("rev-parse", "HEAD", cwd=path)


def _ensure_checkout(
    destination: Path,
    *,
    url: str,
    commit: str,
    branch: str | None = None,
) -> None:
    if destination.exists():
        if not (destination / ".git").exists():
            raise RuntimeError(f"Existing path is not a Git checkout: {destination}")
        actual = git_commit(destination)
        if actual != commit:
            raise RuntimeError(
                f"Refusing to alter existing checkout {destination}: "
                f"expected {commit}, found {actual}"
            )
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    clone_args = ["clone"]
    if branch:
        clone_args.extend(["--branch", branch])
    clone_args.extend([url, str(destination)])
    _git(*clone_args)
    _git("checkout", "--detach", commit, cwd=destination)


def locate_upstream(checkout_dir: Path) -> UpstreamSource:
    checkout_dir = Path(checkout_dir).resolve()
    shapmat = checkout_dir / "shapmat"
    paper = checkout_dir / "shapmat_paper"
    if not shapmat.is_dir() or not paper.is_dir():
        raise FileNotFoundError(
            f"Expected shapmat and shapmat_paper checkouts under {checkout_dir}"
        )

    candidates = [
        shapmat / "data" / "curatedCRC.csv",
        paper / "data" / "curatedCRC.csv",
    ]
    matches = [path for path in candidates if path.is_file()]
    if len(matches) != 1:
        raise FileNotFoundError(
            "Expected exactly one curatedCRC.csv in the upstream clones; "
            f"found {matches}. Inspect shapmat_paper/scripts/get_data.R to regenerate it."
        )

    return UpstreamSource(
        data_path=matches[0],
        shapmat_commit=git_commit(shapmat),
        paper_commit=git_commit(paper),
        sha256=sha256_file(matches[0]),
    )


def acquire_upstream(checkout_dir: Path) -> UpstreamSource:
    checkout_dir = Path(checkout_dir).resolve()
    _ensure_checkout(
        checkout_dir / "shapmat",
        url=SHAPMAT_URL,
        branch=SHAPMAT_BRANCH,
        commit=SHAPMAT_COMMIT,
    )
    _ensure_checkout(
        checkout_dir / "shapmat_paper",
        url=PAPER_URL,
        commit=PAPER_COMMIT,
    )
    return locate_upstream(checkout_dir)
