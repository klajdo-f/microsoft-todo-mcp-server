import { createServer } from "http"

const server = createServer((req, res) => {
  console.error()
  if (req.url?.startsWith("/callback")) {
    console.error("[TEST] Matched /callback!")
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end("<h1>Callback received!</h1>")
  } else {
    res.writeHead(404)
    res.end("Not found")
  }
})

server.listen(4040, () => {
  console.error("[TEST] Listening on port 4040")
})

server.on("error", (err) => {
  console.error()
})

// Keep process alive
setInterval(() => {}, 1000)
