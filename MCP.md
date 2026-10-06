# photos MCP server

The app is a [Model Context Protocol](https://modelcontextprotocol.io) server:
every HTTP API route is a tool, so an agent can drive photos the way the page
and the headless CLI do. The tools call the same `/api` routes, so what a
tool can do is exactly what the API can do, no more and no less.

There are two ways in:

- **Streamable HTTP**, built into the app server at `POST /mcp`. It is there
  whenever the app is running, in `bun dev`, `bun start` or
  `bun run headless`. Nothing extra to start.
- **stdio**, `bun run mcp`, for clients that launch a server process. It
  connects to a running app server, or starts its own API-only one with
  `--start`.

## Connect

With the app running on port 3000:

```sh
claude mcp add --transport http photos http://localhost:3000/mcp
```

For a client that launches processes (Claude Desktop, Codex, Claude Code with
stdio), point it at `mcp.js` and let it start its own server:

```json
{
  "mcpServers": {
    "photos": {
      "command": "bun",
      "args": ["/path/to/photos/mcp.js", "--start"]
    }
  }
}
```

`--start` runs `HEADLESS=1 HOST=127.0.0.1 PORT=0 bun server.js` from this
repository, with the same data directory and environment as `bun dev`, and
stops it when the client disconnects. Do not use it while another server is
already running against the same data directory: connect to that server
instead. Without `--start`, the URL precedence is `--base-url`, then
`PHOTOS_API_URL`, then `http://localhost:3000`. `bun run mcp --help` lists the
tools without needing a server.

The package declares the `photos-mcp` executable, available after an optional
`bun link`, alongside `photos-cli`.

## Tools

| Tool                   | HTTP API                 | Purpose                                                                                                                                                    |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photos_library_list`  | `GET /api/library`       | Every photo (newest first) with its metadata, favorites, the albums, and the trash batches.                                                                |
| `photos_rescan`        | `POST /api/rescan`       | Walk the photos folder again, picking up files added outside the app. force re-reads metadata for every file.                                              |
| `photos_file_get`      | `GET /api/file`          | The photo itself. Images up to 3 MB come back inline; larger ones come back as a link to the API. output saves the file locally instead.                   |
| `photos_thumb_get`     | `GET /api/thumb`         | The embedded preview when the file has one (JPEG), otherwise the file itself. The cheap way to look at a photo.                                            |
| `photos_upload`        | `POST /api/upload`       | Add image files from the local disk (paths on the machine running the app). Returns the library paths under uploaded and any refused files under rejected. |
| `photos_photo_update`  | `PATCH /api/photo`       | Set a photo's title, caption or tags. Passing an empty value clears that field; reset clears all three.                                                    |
| `photos_photo_trash`   | `DELETE /api/photo`      | Move photos to the trash as one batch. Returns the batchId that photos_trash_restore takes.                                                                |
| `photos_favorite_set`  | `POST /api/favorite`     | Mark or unmark a photo as a favorite.                                                                                                                      |
| `photos_albums_create` | `POST /api/albums`       | Create an album, optionally with photos in it.                                                                                                             |
| `photos_albums_update` | `PATCH /api/albums/:id`  | Rename an album, replace its photos with paths, or change them with add and remove.                                                                        |
| `photos_albums_delete` | `DELETE /api/albums/:id` | Delete an album. The photos stay in the library.                                                                                                           |
| `photos_trash_restore` | `POST /api/trash`        | Put a trashed batch back where it came from.                                                                                                               |
| `photos_trash_empty`   | `DELETE /api/trash`      | Permanently delete everything in the trash. Cannot be undone.                                                                                              |

Every tool takes one JSON object. Its schema (from `tools/list`) names each
argument and marks the required ones; the runtime rejects a missing required
argument, a wrong type, a value outside an enum, or an argument the tool does
not have, before anything is sent. Path parameters (`:id`) and query
parameters are filled from the arguments of the same name; whatever is left
becomes the JSON body. The API applies its own domain rules after that, the
same ones the page and the CLI get.

Paths in these examples are illustrative: use the exact path `photos_upload`
or `photos_library_list` returns, since uploads are filed under
`YYYY/YYYY-MM-DD` by the date taken. `photos_thumb_get` is the cheap way to
look at a photo; `photos_file_get` returns the original inline only when it
is under the inline limit.

## Examples

Tool calls, as name and arguments:

```
photos_library_list {"rescan":true}
photos_upload {"files":["/home/me/Pictures/walk.jpg"]}
photos_thumb_get {"path":"2026/2026-09-06/walk.jpg"}
photos_photo_update {"path":"2026/2026-09-06/walk.jpg","title":"A walk","tags":["outdoors"]}
photos_albums_create {"name":"Walks","paths":["2026/2026-09-06/walk.jpg"]}
photos_photo_trash {"paths":["2026/2026-09-06/walk.jpg"]}
```

## Results

- A JSON reply comes back twice: pretty-printed as a `text` block, and as
  `structuredContent` for clients that read it. `isError` is set when the
  API answered an error status (the payload then carries `error`, `status`
  and `details`), when a notebook cell run failed, or when every uploaded
  file was rejected. A partly rejected upload or a feed that failed inside a
  successful list is a success whose payload says what went wrong.
- Upload tools take `files`: paths on the machine running the app, sent as
  multipart `files`; any other argument becomes a text field.
- Download tools (the ones that return bytes) answer with an `image` block
  when the reply is an image under 3 MB (`MCP_INLINE_IMAGE_BYTES` changes the
  limit), a `text` block when it is text or SVG, and otherwise a
  `resource_link` to the API URL. `output` saves the bytes to a local file
  instead and answers with the path and size; an existing file is replaced
  only after the whole reply arrived.
- `notifications/cancelled` aborts the API request behind a call. A call
  that has not answered after 300 seconds is an error.

## Verification

```sh
bun run test:mcp     # protocol, transport and every tool against a real server
bun run test         # the CLI suite too
```
