// A deliberately buggy app to try QA Pilot on. Run: node examples/demo-app/server.mjs (port 5055)
import http from "node:http";

const PORT = Number(process.env.PORT ?? 5055);
const TOKEN = "demo-token";

const layout = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:Arial;margin:0}nav{background:#222;padding:12px}nav a{color:#fff;margin-right:16px}
main{padding:24px}.card{border:1px solid #ddd;padding:16px;border-radius:8px;margin:8px 0}</style></head>
<body><nav><a href="/">Home</a><a href="/dashboard">Dashboard</a><a href="/settings">Settings</a><a href="/old-page">Old page</a></nav><main>${body}</main></body></html>`;

const pages = {
  "/": layout("Demo Home", `<h1>Welcome to Demo</h1><p>Your AI assistant for everything.</p>
    <img src="/missing-logo.png" width="120" height="40" alt="logo">
    <button onclick="document.getElementById('o').innerText='Saved!'">Save</button><div id="o"></div>`),
  "/dashboard": layout("Dashboard", `<h1>Dashboard</h1><div class="card">Total revenue: <b id="rev"></b></div>
    <div class="card" style="width:900px">Wide analytics table that breaks on mobile</div>
    <input placeholder="Search"><button style="color:#bbb;background:#ccc">Go</button>
    <script>
      document.getElementById('rev').innerText = 'Rs ' + (undefined * 3);
      fetch('/api/stats').then(r => r.json()).then(d => console.log(d));
      const auth = { headers: { Authorization: 'Bearer demo-token' } };
      fetch('/api/users', auth).then(r => r.json()).then(u => fetch('/api/users/' + u[0].id, auth));
      setTimeout(() => { null.crash(); }, 100);
    </script>`),
  "/settings": layout("Settings", `<h1>Settings</h1><form onsubmit="event.preventDefault();document.getElementById('m').innerText='Profile updated for ' + this.email.value">
    <label>Email <input name="email" type="text"></label><button type="submit">Update</button></form><p id="m"></p>`),
};

const users = [{ id: 1, name: "Ali", email: "ali@example.com" }, { id: 2, name: "Sara", email: "sara@example.com" }];

const spec = {
  openapi: "3.0.3",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/api" }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: {
      User: { type: "object", required: ["id", "name", "email"], properties: { id: { type: "integer" }, name: { type: "string" }, email: { type: "string", format: "email" } } },
    },
  },
  paths: {
    "/users": { get: { tags: ["users"], summary: "List users", responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/User" } } } } } } } },
    "/users/{id}": {
      get: {
        tags: ["users"],
        summary: "Get one user",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } }, 404: { description: "not found" } },
      },
    },
    "/stats": { get: { tags: ["stats"], summary: "Dashboard stats", responses: { 200: { description: "ok" } } } },
  },
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const authed = req.headers.authorization === `Bearer ${TOKEN}`;
    if (url.pathname === "/openapi.json") return json(res, 200, spec);
    // BUG: no auth check on /api/users
    if (url.pathname === "/api/users") return json(res, 200, users.map((u) => ({ ...u, id: String(u.id) }))); // BUG: id is a string
    const m = url.pathname.match(/^\/api\/users\/(.+)$/);
    if (m) {
      if (!authed) return json(res, 401, { error: "unauthorized" });
      const u = users.find((x) => String(x.id) === m[1]);
      if (!u && isNaN(Number(m[1]))) {
        // BUG: crashes on non-numeric id and leaks a stack trace
        return json(res, 500, { error: "TypeError: Cannot read properties of undefined", stack: "at getUser (/app/src/users.js:42:13)" });
      }
      return u ? json(res, 200, u) : json(res, 404, { error: "not found" });
    }
    if (url.pathname === "/api/stats") return json(res, 500, { error: "db timeout" }); // BUG
    if (url.pathname === "/api/chat" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const { message } = JSON.parse(b || "{}");
        // BUG: always answers in English and invents a phone number
        json(res, 200, { reply: `Thanks for asking about "${message}". Call our support at +92-300-0000000 any time, we are open 24/7.` });
      });
      return;
    }
    // Passcode-protected "approved design" (reference site) — passcode: 1234
    if (url.pathname === "/ref-unlock" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const ok = new URLSearchParams(b).get("passcode") === "1234";
        res.writeHead(302, { Location: ok ? "/ref/dashboard" : "/ref/dashboard?wrong=1", ...(ok ? { "Set-Cookie": "ref=ok; Path=/" } : {}) });
        res.end();
      });
      return;
    }
    if (url.pathname.startsWith("/ref/")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      if (!(req.headers.cookie ?? "").includes("ref=ok")) {
        return res.end(layout("Locked", `<h1>Enter passcode</h1><form method="post" action="/ref-unlock"><input type="password" name="passcode" placeholder="Passcode"><button type="submit">Unlock</button></form>`));
      }
      return res.end(layout("Dashboard", `<h1 style="color:#2563eb;font-size:40px">Dashboard Overview</h1><div class="card">Total revenue: <b>Rs 120,000</b></div><div class="card">Analytics table</div><input placeholder="Search"><button>Go</button>`));
    }
    const page = pages[url.pathname];
    if (page) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(page);
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(layout("Not found", "<h1>404</h1>"));
  })
  .listen(PORT, () => console.log(`Demo buggy app on http://localhost:${PORT}`));
