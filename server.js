const headless = process.env.HEADLESS === "1";
const index = headless ? null : (await import("./index.html")).default;
import mcpConfig from "./src/mcp/tools.js";
import { createMcpHttpHandler, loopbackUrl } from "./src/mcp/runtime.js";
import {
  LibraryError,
  createAlbum,
  createLibrary,
  deleteAlbum,
  emptyTrash,
  listLibrary,
  parseRange,
  photoFile,
  restoreTrash,
  saveUpload,
  scan,
  setFavorite,
  setOverride,
  thumbFile,
  trashPhotos,
  updateAlbum,
} from "./src/server/library.js";

const library = createLibrary({
  photosDir: process.env.PHOTOS_DIR || "./photos",
  dataDir: process.env.PHOTOS_DATA_DIR || "./data",
});

const json = (body, status = 200) => Response.json(body, { status });

async function jsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function wrap(handler) {
  return async (req) => {
    try {
      return await handler(req, new URL(req.url));
    } catch (error) {
      if (error instanceof LibraryError)
        return json({ error: error.message }, error.status);
      return json(
        { error: error instanceof Error ? error.message : "Request failed." },
        500,
      );
    }
  };
}

function albumId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    throw new LibraryError("Invalid album id.");
  return id;
}

/* MCP over streamable HTTP: the same API, as tools. The handler calls back
 * into this server over loopback, so it needs the address after the fact. */
const mcp = createMcpHttpHandler(mcpConfig, {
  baseUrl: () => loopbackUrl(server),
});

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  hostname: process.env.HOST || "0.0.0.0",
  development: process.env.NODE_ENV !== "production",
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 1024,
  routes: {
    ...(headless ? {} : { "/": index }),
    "/api/library": {
      GET: wrap(async (req, url) => {
        if (url.searchParams.get("rescan") === "1") await scan(library);
        return json(await listLibrary(library));
      }),
    },
    "/api/rescan": {
      POST: wrap(async (req, url) => {
        const result = await scan(library, {
          force: url.searchParams.get("force") === "1",
        });
        return json(result);
      }),
    },
    "/api/file": {
      GET: wrap(async (req, url) => {
        const { fullPath, size, contentType } = await photoFile(
          library,
          url.searchParams.get("path"),
        );
        const range = parseRange(req.headers.get("range"), size);
        const headers = {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          "Content-Type": contentType,
        };
        if (range) {
          return new Response(
            Bun.file(fullPath).slice(range.start, range.end + 1),
            {
              status: 206,
              headers: {
                ...headers,
                "Content-Length": String(range.end - range.start + 1),
                "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
              },
            },
          );
        }
        return new Response(Bun.file(fullPath), {
          headers: { ...headers, "Content-Length": String(size) },
        });
      }),
    },
    /* The embedded preview when the file carries one, the file itself when
     * it does not -- either way the grid asks for one URL. */
    "/api/thumb": {
      GET: wrap(async (req, url) => {
        const relativePath = url.searchParams.get("path");
        const thumb = await thumbFile(library, relativePath);
        if (thumb)
          return new Response(Bun.file(thumb), {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "private, max-age=86400",
            },
          });
        const { fullPath, size, contentType } = await photoFile(
          library,
          relativePath,
        );
        return new Response(Bun.file(fullPath), {
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(size),
            "Cache-Control": "private, max-age=86400",
          },
        });
      }),
    },
    "/api/upload": {
      POST: wrap(async (req) => {
        const form = await req.formData().catch(() => null);
        if (!form) return json({ error: "Expected multipart form data." }, 400);
        const uploaded = [];
        const rejected = [];
        for (const entry of form.getAll("files")) {
          try {
            uploaded.push(await saveUpload(library, entry));
          } catch (error) {
            rejected.push({
              name: entry?.name || "file",
              error: error instanceof Error ? error.message : "Rejected.",
            });
          }
        }
        if (uploaded.length) await scan(library);
        return json({ uploaded, rejected });
      }),
    },
    "/api/photo": {
      PATCH: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await setOverride(library, body.path, body));
      }),
      DELETE: wrap(async (req, url) => {
        const paths = url.searchParams.getAll("path");
        return json(await trashPhotos(library, paths));
      }),
    },
    "/api/favorite": {
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(
          await setFavorite(library, body.path, body.favorite !== false),
        );
      }),
    },
    "/api/trash": {
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body?.batchId) return json({ error: "Invalid JSON body" }, 400);
        const result = await restoreTrash(library, body.batchId);
        return json(result);
      }),
      DELETE: wrap(async () => json(await emptyTrash(library))),
    },
    "/api/albums": {
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await createAlbum(library, body), 201);
      }),
    },
    "/api/albums/:id": {
      PATCH: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await updateAlbum(library, albumId(req), body));
      }),
      DELETE: wrap(async (req) =>
        json(await deleteAlbum(library, albumId(req))),
      ),
    },
    "/mcp": mcp,
    "/api/*": () => json({ error: "Not found" }, 404),
  },
  fetch: () => headless ? json({ error: "Not found" }, 404) : new Response(index),
});

scan(library)
  .then((result) =>
    console.log(
      `photos  http://localhost:${server.port}  ${result.count} photos in ${library.photosDir} (${result.read} newly read)`,
    ),
  )
  .catch((error) => console.error("scan failed:", error));
