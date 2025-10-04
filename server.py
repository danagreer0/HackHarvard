from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to all responses
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        # Respond to CORS preflight
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        # Minimal POST handler: echoes request body
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b""
        content_type = self.headers.get("Content-Type", "")

        self.send_response(200)
        if "application/json" in content_type:
            self.send_header("Content-Type", "application/json")
        else:
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()

        if body:
            self.wfile.write(body)
        else:
            if "application/json" in content_type:
                self.wfile.write(b"{}")
            else:
                self.wfile.write(b"ok")

if __name__ == "__main__":
    host = "0.0.0.0"
    port = 8000
    httpd = ThreadingHTTPServer((host, port), CORSRequestHandler)
    print(f"Serving {os.getcwd()} at http://{host}:{port} (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
