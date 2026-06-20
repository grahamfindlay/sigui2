"""``sigui2`` command-line entry point: launch the server for an analyzer."""

from __future__ import annotations

import argparse
import webbrowser

import uvicorn

from .server.app import create_app
from .server.session import Session


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="sigui2", description=__doc__)
    parser.add_argument("analyzer", nargs="?", default=None,
                        help="SortingAnalyzer folder/zarr path")
    parser.add_argument("--synthetic", action="store_true",
                        help="Use a cached synthetic analyzer (no NFS needed)")
    parser.add_argument("--synthetic-segments", type=int, default=1,
                        help="Number of segments in the synthetic analyzer "
                             "(>1 exercises F3 segment navigation)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-traces", action="store_true")
    parser.add_argument("--open", action="store_true", help="Open a browser")
    args = parser.parse_args(argv)

    if args.synthetic or args.analyzer is None:
        from .testing import cached_synthetic_analyzer
        print("Loading synthetic analyzer (cached)...")
        kwargs = {}
        if args.synthetic_segments > 1:
            # Short segments keep the build/cache cheap; enough to drive the
            # segment dropdown + per-segment seek.
            kwargs["durations"] = [20.0] * args.synthetic_segments
        analyzer = cached_synthetic_analyzer(**kwargs)
    else:
        from spikeinterface import load_sorting_analyzer
        print(f"Loading analyzer: {args.analyzer}")
        analyzer = load_sorting_analyzer(args.analyzer, load_extensions=False)

    session = Session(analyzer, with_traces=not args.no_traces)
    app = create_app(session)
    url = f"http://{args.host}:{args.port}"
    print(f"sigui2 serving at {url}  (ws at {url}/ws)")
    if args.open:
        webbrowser.open(url)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
