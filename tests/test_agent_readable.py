"""The site has to be readable by something that does not run JavaScript.

An AI agent, a crawler and a link preview all get one HTTP GET and no
hydration. From a single-page app that is an empty mount div and a script tag,
so everything a program could say about this service came from the `<head>` —
including, until now, nothing at all about why the game exists.

Two answers, and these tests hold both. The build server-renders the prose
routes into the response body, and `beesknees_guide` serves the same
orientation through the MCP door so an agent never has to scrape the front one.
"""

from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUIDE = ROOT / "src" / "beesknees_mcp" / "llms.txt"


def test_the_guide_exists_once() -> None:
    """One document, two publications — not two documents.

    The website serves this file at `/llms.txt` and `beesknees_guide` returns
    it. If a second copy appears under `frontend/public/`, both are served,
    neither is canonical, and they drift until an agent is told something the
    site stopped saying.
    """
    assert GUIDE.is_file(), f"the canonical guide is missing: {GUIDE}"
    stray = ROOT / "frontend" / "public" / "llms.txt"
    assert not stray.exists(), (
        f"{stray} is a second copy of the guide. The build copies the canonical "
        "one out of the package; delete this and let it."
    )


def test_the_wheel_carries_the_guide() -> None:
    """`beesknees_guide` reads a file at import.

    A checkout has it either way, so this cannot be caught by running the tool
    locally — it fails the first time the wheel is imported on Horizon, with a
    FileNotFoundError at module scope that takes the whole server with it.
    """
    pyproject = (ROOT / "pyproject.toml").read_text()
    assert re.search(r"^\[tool\.setuptools\.package-data\]", pyproject, re.MULTILINE), (
        "pyproject.toml declares no package-data, so llms.txt is not in the wheel"
    )
    assert re.search(r'^beesknees_mcp\s*=\s*\[[^\]]*"llms\.txt"', pyproject, re.MULTILINE), (
        "package-data does not list llms.txt"
    )


def test_the_build_copies_the_guide_rather_than_keeping_a_second_one() -> None:
    prerender = (ROOT / "frontend" / "scripts" / "prerender.mjs").read_text()
    assert "../src/beesknees_mcp/llms.txt" in prerender, (
        "prerender.mjs no longer copies the canonical guide into dist/"
    )


def test_the_prose_routes_are_prerendered_and_the_live_ones_are_not() -> None:
    """`/ledger` must NOT be prerendered, and that is the load-bearing half.

    The ledger is money — what has been raised and what has reached the
    charity. A build-time snapshot of it would serve figures that were true at
    deploy as though they were true now, which is worse than serving none.
    """
    prerender = (ROOT / "frontend" / "scripts" / "prerender.mjs").read_text()
    prose = prerender[prerender.index("const PROSE = ["):prerender.index("];", prerender.index("const PROSE = ["))]
    # `/why` is the load-bearing one: it carries the pollinator argument, and
    # when Play took the root it would otherwise have had no URL at all — a
    # fetcher follows only links it has been shown, and a router rotation is
    # not one.
    for page in ('"/"', '"/why"', '"/about"'):
        assert page in prose, f"{page} is not prerendered"
    for live in ("/ledger", "/play", "/profile", "/operator"):
        assert f'"{live}"' not in prose, f"{live} is live data and must not be frozen into a build"


def test_the_build_runs_the_prerender() -> None:
    """A step nothing invokes is a step that does not happen."""
    import json

    pkg = json.loads((ROOT / "frontend" / "package.json").read_text())
    assert "prerender" in pkg["scripts"], "no prerender script"
    build = pkg["scripts"]["build"]
    assert "prerender" in build, f"build does not run prerender: {build}"
    assert build.index("vite build") < build.index("prerender"), (
        "prerender must run AFTER vite build — it fills the shell vite emits"
    )


def test_the_spa_fallback_stays_on_the_one_path_pages_special_cases() -> None:
    """Measured, not assumed: `wrangler pages dev` answered `/robots.txt` with
    HTML the moment this pointed anywhere but `/index.html`. That is the exact
    bug the robots.txt file was added to fix, reintroduced from another angle.
    """
    redirects = (ROOT / "frontend" / "public" / "_redirects").read_text()
    rule = [ln for ln in redirects.splitlines() if ln.strip().startswith("/*")]
    assert rule, "no SPA fallback rule"
    assert rule[0].split() == ["/*", "/index.html", "200"], (
        f"the fallback must rewrite to /index.html, got: {rule[0]}"
    )
