const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const imageDirectory = path.join(root, "images");
const reportDirectory = path.join(root, "reports");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
fs.mkdirSync(imageDirectory, { recursive: true });
fs.mkdirSync(reportDirectory, { recursive: true });

function serveFile(request, response) {
  const requestedPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.normalize(path.join(root, requestedPath));
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      mimeTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/attendance-photo") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const match = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(
          payload.image || "",
        );
        if (!match) throw new Error("Invalid image");
        const extension = match[1] === "png" ? "png" : "jpg";
        const filename = `presensi-${new Date().toISOString().replace(/[.:]/g, "-")}.${extension}`;
        fs.writeFileSync(
          path.join(imageDirectory, filename),
          Buffer.from(match[2], "base64"),
        );
        fs.appendFileSync(
          path.join(imageDirectory, "presensi-log.jsonl"),
          `${JSON.stringify({ filename, location: payload.location || null, createdAt: new Date().toISOString() })}\n`,
        );
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, filename }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ ok: false, message: "Foto tidak valid" }),
        );
      }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/api/report-upload") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 14_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const safeName = path.basename(payload.filename || "");
        const extension = path.extname(safeName).toLowerCase();
        const allowedExtensions = [".pdf", ".doc", ".docx"];
        const match = /^data:(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,(.+)$/.exec(payload.data || "");
        if (!safeName || !allowedExtensions.includes(extension) || !match) throw new Error("Invalid report");
        const filename = `laporan-${Date.now()}-${safeName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fs.writeFileSync(path.join(reportDirectory, filename), Buffer.from(match[2], "base64"));
        fs.appendFileSync(path.join(reportDirectory, "laporan-log.jsonl"), `${JSON.stringify({ filename, originalName: safeName, createdAt: new Date().toISOString() })}\n`);
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, filename }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "File laporan tidak valid" }));
      }
    });
    return;
  }
  serveFile(request, response);
});

server.listen(3000, () =>
  console.log("Presensi PKL berjalan di http://localhost:3000"),
);
