"""Partes comuns dos workers de voz: servidor HTTP local e encerramento junto com o app."""
import ctypes
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SYNCHRONIZE = 0x100000
INFINITE = 0xFFFFFFFF


def setup_log(path):
    logging.basicConfig(filename=path, level=logging.INFO, format="%(asctime)s %(message)s", encoding="utf-8")


def exit_with_parent(pid):
    """Fecha o worker quando o Assistente termina, mesmo se ele cair."""
    def wait():
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        ctypes.windll.kernel32.WaitForSingleObject(handle, INFINITE)
        os._exit(0)

    threading.Thread(target=wait, daemon=True).start()


def serve(port, routes):
    """Servidor só em 127.0.0.1. routes: {"/caminho": funcao(dict) -> dict}."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, data, code=200):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.send({"ok": True}) if self.path == "/health" else self.send_error(404)

        def do_POST(self):
            route = routes.get(self.path)
            if not route:
                self.send_error(404)
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                self.send({"ok": True, **(route(body) or {})})
            except Exception as e:
                logging.exception("falha em %s", self.path)
                self.send({"ok": False, "error": str(e)}, 500)

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
