export default async function handler(req, res) {
  const accept = String(req.headers.accept || "");
  if (accept.includes("text/html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send("<!doctype html><meta charset='utf-8'><title>Backup Agenda Pro</title><h1>Backup Agenda Pro</h1><p>Arquivo ZIP pronto para download.</p>");
    return;
  }
  const url = "https://codeload.github.com/grafficaatos-coder/pagamente/zip/refs/heads/backup-agenda-pro-2026-10-06";
  const r = await fetch(url);
  if (!r.ok) {
    res.status(r.status).send("Não foi possível gerar o backup.");
    return;
  }
  const data = Buffer.from(await r.arrayBuffer());
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="agenda-pro-completo-2026-10-06.zip"');
  res.setHeader("Content-Length", String(data.length));
  res.status(200).send(data);
}
