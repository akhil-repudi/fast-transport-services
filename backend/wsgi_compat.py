"""
Minimal Flask-compatible WSGI micro-adapter built strictly on Python's stdlib.

When `flask` is installed (e.g. via `pip install -r requirements.txt`), `app.py`
uses the real Flask framework. In constrained environments without pip/Flask,
this adapter provides the subset of Flask's API used by `app.py` over
`wsgiref.simple_server` + `socketserver.ThreadingMixIn`.
"""

from __future__ import annotations

import json
import re
from http.cookies import SimpleCookie
from socketserver import ThreadingMixIn
from typing import Any, Callable
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIServer, make_server


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class Response:
    def __init__(self, body: str | bytes = "", status: int = 200, mimetype: str = "application/json"):
        self.body = body.encode("utf-8") if isinstance(body, str) else body
        self.status_code = status
        self.headers: dict[str, str] = {"Content-Type": mimetype}
        self._cookies: list[str] = []

    def set_cookie(
        self,
        key: str,
        value: str = "",
        httponly: bool = True,
        samesite: str = "Lax",
        path: str = "/",
        max_age: int | None = None,
    ) -> None:
        parts = [f"{key}={value}", f"Path={path}", f"SameSite={samesite}"]
        if httponly:
            parts.append("HttpOnly")
        if max_age is not None:
            parts.append(f"Max-Age={max_age}")
        self._cookies.append("; ".join(parts))

    def delete_cookie(self, key: str, path: str = "/") -> None:
        self.set_cookie(key, "", httponly=True, path=path, max_age=0)


class RequestProxy:
    def __init__(self) -> None:
        self.method: str = "GET"
        self.path: str = "/"
        self.args: dict[str, str] = {}
        self.headers: dict[str, str] = {}
        self.cookies: dict[str, str] = {}
        self._raw_body: bytes = b""

    def get_json(self, silent: bool = False) -> Any:
        if not self._raw_body:
            return {} if silent else None
        try:
            return json.loads(self._raw_body.decode("utf-8"))
        except Exception:
            if silent:
                return {}
            raise


request = RequestProxy()


class GNamespace:
    pass


g = GNamespace()


def jsonify(data: Any) -> Response:
    return Response(json.dumps(data), status=200, mimetype="application/json")


def make_response(rv: Any, status: int | None = None) -> Response:
    if isinstance(rv, tuple):
        body_obj = rv[0]
        code = rv[1]
        resp = body_obj if isinstance(body_obj, Response) else jsonify(body_obj)
        resp.status_code = code
        return resp
    if isinstance(rv, Response):
        if status is not None:
            rv.status_code = status
        return rv
    resp = jsonify(rv)
    if status is not None:
        resp.status_code = status
    return resp


class _TestClient:
    def __init__(self, app: "Flask"):
        self.app = app
        self.cookies: dict[str, str] = {}

    def open(self, path: str, method: str = "GET", json_data: Any = None, headers: dict[str, str] | None = None):
        qs = ""
        if "?" in path:
            path, qs = path.split("?", 1)
        body_bytes = json.dumps(json_data).encode("utf-8") if json_data is not None else b""
        environ = {
            "REQUEST_METHOD": method.upper(),
            "PATH_INFO": path,
            "QUERY_STRING": qs,
            "CONTENT_LENGTH": str(len(body_bytes)),
            "wsgi.input": _BytesReader(body_bytes),
        }
        if headers:
            for k, v in headers.items():
                environ[f"HTTP_{k.upper().replace('-', '_')}"] = v
        if self.cookies and "HTTP_COOKIE" not in environ:
            environ["HTTP_COOKIE"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())

        captured: dict[str, Any] = {}

        def start_response(status_str: str, resp_headers: list[tuple[str, str]]) -> None:
            captured["status"] = int(status_str.split(" ", 1)[0])
            captured["headers"] = resp_headers

        chunks = b"".join(self.app(environ, start_response))
        for k, v in captured.get("headers", []):
            if k.lower() == "set-cookie":
                cookie_part = v.split(";", 1)[0]
                if "=" in cookie_part:
                    ck, cv = cookie_part.split("=", 1)
                    if "Max-Age=0" in v:
                        self.cookies.pop(ck, None)
                    else:
                        self.cookies[ck] = cv
        return _TestResponse(captured["status"], chunks, captured.get("headers", []))

    def get(self, path: str, headers: dict[str, str] | None = None):
        return self.open(path, "GET", headers=headers)

    def post(self, path: str, json: Any = None, headers: dict[str, str] | None = None):
        return self.open(path, "POST", json_data=json, headers=headers)

    def put(self, path: str, json: Any = None, headers: dict[str, str] | None = None):
        return self.open(path, "PUT", json_data=json, headers=headers)

    def patch(self, path: str, json: Any = None, headers: dict[str, str] | None = None):
        return self.open(path, "PATCH", json_data=json, headers=headers)

    def delete(self, path: str, headers: dict[str, str] | None = None):
        return self.open(path, "DELETE", headers=headers)


class _BytesReader:
    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            chunk = self._data[self._pos :]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk


class _TestResponse:
    def __init__(self, status_code: int, data: bytes, headers: list[tuple[str, str]]):
        self.status_code = status_code
        self.data = data
        self.headers = dict(headers)

    def get_json(self) -> Any:
        return json.loads(self.data.decode("utf-8"))


STATUS_PHRASES = {
    200: "200 OK",
    201: "201 Created",
    204: "204 No Content",
    400: "400 Bad Request",
    401: "401 Unauthorized",
    403: "403 Forbidden",
    404: "404 Not Found",
    409: "409 Conflict",
    500: "500 Internal Server Error",
}


class Flask:
    def __init__(self, import_name: str):
        self.import_name = import_name
        self.config: dict[str, Any] = {}
        self._routes: list[tuple[re.Pattern[str], set[str], Callable[..., Any]]] = []

    def route(self, rule: str, methods: list[str] | None = None):
        allowed = {m.upper() for m in (methods or ["GET"])}

        def _replace_param(match: re.Match[str]) -> str:
            kind, name = match.group(1), match.group(2)
            if kind == "int":
                return f"(?P<{name}>\\d+)"
            return f"(?P<{name}>[^/]+)"

        pattern_str = re.sub(r"<(?:(int):)?([a-zA-Z_][a-zA-Z0-9_]*)>", _replace_param, rule)
        compiled = re.compile(f"^{pattern_str}$")

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self._routes.append((compiled, allowed, fn))
            return fn

        return decorator

    def test_client(self) -> _TestClient:
        return _TestClient(self)

    def __call__(self, environ: dict[str, Any], start_response: Callable[..., Any]):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
        qs = environ.get("QUERY_STRING", "")
        parsed_qs = {k: v[0] for k, v in parse_qs(qs, keep_blank_values=True).items()}

        headers: dict[str, str] = {}
        for k, v in environ.items():
            if k.startswith("HTTP_"):
                header_name = k[5:].replace("_", "-").title()
                headers[header_name] = v

        cookies: dict[str, str] = {}
        if "Cookie" in headers:
            sc = SimpleCookie()
            sc.load(headers["Cookie"])
            cookies = {k: morsel.value for k, morsel in sc.items()}

        content_length = int(environ.get("CONTENT_LENGTH") or 0)
        raw_body = environ["wsgi.input"].read(content_length) if content_length > 0 else b""

        request.method = method
        request.path = path
        request.args = parsed_qs
        request.headers = headers
        request.cookies = cookies
        request._raw_body = raw_body
        g.current_user = None

        if method == "OPTIONS":
            resp = Response("", status=204, mimetype="text/plain")
            return self._send(resp, start_response)

        matched_fn = None
        matched_kwargs: dict[str, Any] = {}
        path_matched = False

        for pattern, allowed_methods, fn in self._routes:
            m = pattern.match(path)
            if m:
                path_matched = True
                if method in allowed_methods:
                    matched_fn = fn
                    for k, v in m.groupdict().items():
                        matched_kwargs[k] = int(v) if v.isdigit() else v
                    break

        if not matched_fn:
            status = 405 if path_matched else 404
            resp = make_response({"error": "Method not allowed" if path_matched else "Not found"}, status)
            return self._send(resp, start_response)

        try:
            rv = matched_fn(**matched_kwargs)
            resp = make_response(rv)
        except Exception as exc:
            resp = make_response({"error": f"Internal server error: {exc}"}, 500)

        return self._send(resp, start_response)

    def _send(self, resp: Response, start_response: Callable[..., Any]):
        status_line = STATUS_PHRASES.get(resp.status_code, f"{resp.status_code} OK")
        out_headers = [(k, v) for k, v in resp.headers.items()]
        for cookie_header in resp._cookies:
            out_headers.append(("Set-Cookie", cookie_header))
        out_headers.append(("Access-Control-Allow-Credentials", "true"))
        start_response(status_line, out_headers)
        return [resp.body]

    def run(self, host: str = "127.0.0.1", port: int = 5001, debug: bool = False) -> None:
        server = make_server(host, port, self, server_class=ThreadingWSGIServer)
        print(f"WSGI server listening on http://{host}:{port}", flush=True)
        server.serve_forever()
