import { createReadStream } from "node:fs"
import { cp, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { AstroIntegration } from "astro"

const tutorRoot = resolve(
  fileURLToPath(new URL("../../tutor-site/", import.meta.url)),
)

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

export function resolveTutorAssetPath(relativePath: string) {
  const filePath = resolve(tutorRoot, relativePath)
  if (filePath !== tutorRoot && !filePath.startsWith(`${tutorRoot}${sep}`)) {
    throw new Error("Forbidden")
  }
  return filePath
}

async function serveTutorAsset(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
  if (!pathname.startsWith("/tutor/")) {
    next()
    return
  }

  let relativePath: string
  try {
    relativePath = decodeURIComponent(pathname.slice("/tutor/".length))
  } catch {
    response.statusCode = 400
    response.end("Bad request")
    return
  }

  let filePath: string
  try {
    filePath = resolveTutorAssetPath(relativePath)
  } catch {
    response.statusCode = 403
    response.end("Forbidden")
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = resolve(filePath, "index.html")
    if (!(await stat(filePath)).isFile()) {
      next()
      return
    }
  } catch {
    next()
    return
  }

  response.statusCode = 200
  response.setHeader(
    "Content-Type",
    contentTypes.get(extname(filePath).toLowerCase()) ??
      "application/octet-stream",
  )
  createReadStream(filePath).pipe(response)
}

export function tutorSites(): AstroIntegration {
  return {
    name: "tutor-sites",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: "serve-tutor-sites",
                configureServer(server) {
                  server.middlewares.use(serveTutorAsset)
                },
              },
            ],
          },
        })
      },
      "astro:build:done": async ({ dir }) => {
        await cp(tutorRoot, new URL("./tutor/", dir), { recursive: true })
      },
    },
  }
}
