import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";

export const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);
const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const HEADER_BYTES = 512 * 1024;

export class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function contentTypeFor(name) {
  return (
    CONTENT_TYPES[path.extname(name).toLowerCase()] ||
    "application/octet-stream"
  );
}

export function isImageFile(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function cleanRelativePath(value) {
  const text = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!text) return "";
  const parts = text.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.startsWith("."),
    )
  )
    return "";
  return parts.join("/");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pngSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function webpSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      return null;
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    const at = (offset) =>
      bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    return { width: at(24) + 1, height: at(27) + 1 };
  }
  return null;
}

function jpegSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function readHeaderSize(bytes) {
  if (bytes.length < 32) return null;
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  try {
    if (bytes[0] === 0x89 && magic.slice(1) === "PNG") return pngSize(bytes);
    if (magic === "GIF8") return gifSize(bytes);
    if (
      magic === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    )
      return webpSize(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  } catch {
    return null;
  }
  return null;
}

async function readHead(fullPath, size) {
  const length = Math.min(size, HEADER_BYTES);
  if (length <= 0) return null;
  const handle = await open(fullPath, "r");
  try {
    const bytes = new Uint8Array(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    return bytesRead === length ? bytes : bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readMetadata(fullPath, size, mtime) {
  const header = await readHead(fullPath, size).catch(() => null);
  const headerSize = header ? readHeaderSize(header) : null;
  let exif = null;
  if (header) {
    exif = await exifr
      .parse(header, {
        tiff: true,
        exif: true,
        gps: true,
        ifd0: true,
        translateValues: false,
        reviveValues: true,
      })
      .catch(() => null);
  }
  const orientation = Number(exif?.Orientation);
  const rotated =
    Number.isInteger(orientation) && orientation >= 5 && orientation <= 8;
  let width =
    headerSize?.width ||
    positive(exif?.ExifImageWidth) ||
    positive(exif?.ImageWidth) ||
    null;
  let height =
    headerSize?.height ||
    positive(exif?.ExifImageHeight) ||
    positive(exif?.ImageHeight) ||
    null;
  if (rotated && width && height) [width, height] = [height, width];
  const takenAt =
    isoDate(exif?.DateTimeOriginal) ||
    isoDate(exif?.CreateDate) ||
    isoDate(exif?.ModifyDate) ||
    null;
  const camera = cleanText(
    [exif?.Make, exif?.Model].filter(Boolean).join(" "),
  ).slice(0, 120);
  const latitude = Number(exif?.latitude);
  const longitude = Number(exif?.longitude);
  return {
    width,
    height,
    orientation: Number.isInteger(orientation) ? orientation : null,
    takenAt,
    camera,
    lens: cleanText(exif?.LensModel).slice(0, 120),
    iso: positive(exif?.ISO),
    aperture: positive(exif?.FNumber),
    shutter: positive(exif?.ExposureTime),
    focalLength: positive(exif?.FocalLength),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    hasExif: Boolean(exif && Object.keys(exif).length),
    date: takenAt || mtime,
  };
}

export function createLibrary({ photosDir, dataDir }) {
  const data = path.resolve(dataDir);
  return {
    photosDir: path.resolve(photosDir),
    dataDir: data,
    indexFile: path.join(data, "index.json"),
    stateFile: path.join(data, "library.json"),
    thumbDir: path.join(data, "thumbs"),
    trashDir: path.join(data, "trash"),
    index: null,
    state: null,
    scanning: null,
    queue: Promise.resolve(),
    thumbJobs: new Map(),
  };
}

function absolutePath(library, relativePath) {
  const clean = cleanRelativePath(relativePath);
  if (!clean) return null;
  const full = path.join(library.photosDir, clean);
  if (!full.startsWith(library.photosDir + path.sep)) return null;
  return full;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
}

function locked(library, task) {
  const next = library.queue.then(task, task);
  library.queue = next.catch(() => {});
  return next;
}

async function loadState(library) {
  if (library.state) return library.state;
  const parsed = await readJson(library.stateFile, {});
  library.state = {
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    albums: Array.isArray(parsed.albums) ? parsed.albums : [],
    overrides:
      parsed.overrides && typeof parsed.overrides === "object"
        ? parsed.overrides
        : {},
    trash: Array.isArray(parsed.trash) ? parsed.trash : [],
    nextAlbumId: Number(parsed.nextAlbumId) || 1,
  };
  return library.state;
}

async function saveState(library) {
  await writeJson(library.stateFile, library.state);
}

async function walk(library, dir, prefix, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      await walk(library, path.join(dir, entry.name), relative, out);
    else if (entry.isFile() && isImageFile(entry.name)) out.push(relative);
  }
  return out;
}

export function scan(library, { force = false } = {}) {
  if (library.scanning) return library.scanning;
  library.scanning = (async () => {
    try {
      await mkdir(library.photosDir, { recursive: true });
      const previous = force
        ? {}
        : library.index || (await readJson(library.indexFile, {})).photos || {};
      const paths = await walk(library, library.photosDir, "", []);
      const photos = {};
      let read = 0;
      for (const relativePath of paths) {
        const fullPath = path.join(library.photosDir, relativePath);
        const info = await stat(fullPath);
        const key = `${info.size}:${info.mtimeMs}`;
        const cached = previous[relativePath];
        if (cached && cached.key === key) {
          photos[relativePath] = cached;
          continue;
        }
        read += 1;
        photos[relativePath] = {
          key,
          size: info.size,
          updatedAt: info.mtime.toISOString(),
          ...(await readMetadata(
            fullPath,
            info.size,
            info.mtime.toISOString(),
          )),
        };
      }
      library.index = photos;
      await writeJson(library.indexFile, {
        version: 1,
        scannedAt: new Date().toISOString(),
        photos,
      });
      return { count: paths.length, read };
    } finally {
      library.scanning = null;
    }
  })();
  return library.scanning;
}

function folderOf(relativePath) {
  const folder = path.dirname(relativePath);
  return folder === "." ? "" : folder;
}

function serializePhoto(relativePath, entry, state) {
  const override = state.overrides[relativePath] || {};
  const encoded = encodeURIComponent(relativePath);
  return {
    path: relativePath,
    name: path.basename(relativePath),
    folder: folderOf(relativePath),
    url: `/api/file?path=${encoded}`,
    thumbUrl: `/api/thumb?path=${encoded}`,
    contentType: contentTypeFor(relativePath),
    title: cleanText(override.title) || path.basename(relativePath),
    caption: override.caption || "",
    tags: Array.isArray(override.tags) ? override.tags : [],
    width: entry.width,
    height: entry.height,
    orientation: entry.orientation,
    takenAt: entry.takenAt,
    date: entry.date || entry.updatedAt,
    camera: entry.camera,
    lens: entry.lens,
    iso: entry.iso,
    aperture: entry.aperture,
    shutter: entry.shutter,
    focalLength: entry.focalLength,
    latitude: entry.latitude,
    longitude: entry.longitude,
    hasExif: entry.hasExif,
    size: entry.size,
    updatedAt: entry.updatedAt,
    favorite: state.favorites.includes(relativePath),
    edited: Object.keys(override).length > 0,
  };
}

export async function listLibrary(library) {
  if (!library.index) await scan(library);
  const state = await loadState(library);
  const photos = Object.entries(library.index)
    .map(([relativePath, entry]) => serializePhoto(relativePath, entry, state))
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path),
    );
  return {
    photos,
    albums: state.albums,
    trash: state.trash.map((batch) => ({
      id: batch.id,
      count: batch.items.length,
      deletedAt: batch.deletedAt,
    })),
    photosDir: library.photosDir,
  };
}

export async function photoFile(library, relativePath) {
  const fullPath = absolutePath(library, relativePath);
  if (!fullPath || !isImageFile(fullPath))
    throw new LibraryError("Invalid photo path.");
  const info = await stat(fullPath).catch(() => null);
  if (!info || !info.isFile()) throw new LibraryError("Photo not found.", 404);
  return { fullPath, size: info.size, contentType: contentTypeFor(fullPath) };
}

export function parseRange(value, size) {
  if (size <= 0 || !value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

function thumbPath(library, relativePath) {
  const key = library.index?.[relativePath]?.key || "";
  return path.join(
    library.thumbDir,
    `${createHash("sha1").update(`${relativePath}\n${key}`).digest("hex")}.jpg`,
  );
}

export async function thumbFile(library, relativePath) {
  const fullPath = absolutePath(library, relativePath);
  if (!fullPath || !isImageFile(fullPath))
    throw new LibraryError("Invalid photo path.");
  if (!library.index) await scan(library);
  if (!library.index[relativePath]) return null;
  const target = thumbPath(library, relativePath);
  if (
    await stat(target)
      .then((info) => info.isFile() && info.size > 0)
      .catch(() => false)
  )
    return target;
  const running = library.thumbJobs.get(target);
  if (running) return running;
  const job = (async () => {
    try {
      const info = await stat(fullPath).catch(() => null);
      if (!info || !info.isFile()) return null;
      const header = await readHead(fullPath, info.size).catch(() => null);
      if (!header) return null;
      const thumbnail = await exifr.thumbnail(header).catch(() => null);
      if (!thumbnail || !thumbnail.byteLength) return null;
      await mkdir(library.thumbDir, { recursive: true });
      await writeFile(`${target}.tmp`, new Uint8Array(thumbnail));
      await rename(`${target}.tmp`, target);
      return target;
    } catch {
      return null;
    } finally {
      library.thumbJobs.delete(target);
    }
  })();
  library.thumbJobs.set(target, job);
  return job;
}

function safeSegment(value, fallback) {
  const text = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return text || fallback;
}

async function uniquePath(dir, folder, fileName) {
  let relativePath = folder ? `${folder}/${fileName}` : fileName;
  for (
    let index = 2;
    await stat(path.join(dir, relativePath))
      .then(() => true)
      .catch(() => false);
    index += 1
  ) {
    const numbered = fileName.replace(/(\.[^.]+)$/, ` (${index})$1`);
    relativePath = folder ? `${folder}/${numbered}` : numbered;
  }
  return relativePath;
}

export async function saveUpload(library, file) {
  if (!file || typeof file.name !== "string")
    throw new LibraryError("No file.");
  if (!isImageFile(file.name))
    throw new LibraryError(`${file.name}: not an image file.`);
  if (file.size > MAX_UPLOAD_BYTES)
    throw new LibraryError(
      `${file.name}: over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  await mkdir(library.photosDir, { recursive: true });
  const staging = path.join(
    library.photosDir,
    `.upload-${process.pid}-${Date.now()}${path.extname(file.name)}`,
  );
  await writeFile(staging, new Uint8Array(await file.arrayBuffer()));
  try {
    const info = await stat(staging);
    const metadata = await readMetadata(
      staging,
      info.size,
      info.mtime.toISOString(),
    );
    const day = (metadata.date || new Date().toISOString()).slice(0, 10);
    const folder = `${day.slice(0, 4)}/${day}`;
    const extension = path.extname(file.name).toLowerCase();
    const fileName =
      safeSegment(path.basename(file.name, path.extname(file.name)), "photo") +
      extension;
    await mkdir(path.join(library.photosDir, folder), { recursive: true });
    const relativePath = await uniquePath(library.photosDir, folder, fileName);
    await rename(staging, path.join(library.photosDir, relativePath));
    return relativePath;
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

function forgetPhoto(state, relativePath) {
  state.favorites = state.favorites.filter((entry) => entry !== relativePath);
  for (const album of state.albums)
    album.paths = album.paths.filter((entry) => entry !== relativePath);
  delete state.overrides[relativePath];
}

export function trashPhotos(library, paths) {
  return locked(library, async () => {
    const state = await loadState(library);
    const wanted = (Array.isArray(paths) ? paths : [paths])
      .map(cleanRelativePath)
      .filter(Boolean);
    if (wanted.length === 0) throw new LibraryError("No photos given.");
    const id = createHash("sha1")
      .update(`${Date.now()}\n${wanted.join("\n")}`)
      .digest("hex")
      .slice(0, 12);
    const batchDir = path.join(library.trashDir, id);
    const items = [];
    for (const relativePath of wanted) {
      const fullPath = absolutePath(library, relativePath);
      if (!fullPath) continue;
      const info = await stat(fullPath).catch(() => null);
      if (!info || !info.isFile()) continue;
      const target = path.join(batchDir, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(fullPath, target);
      items.push({
        path: relativePath,
        favorite: state.favorites.includes(relativePath),
        override: state.overrides[relativePath] || null,
      });
      forgetPhoto(state, relativePath);
      await rm(thumbPath(library, relativePath), { force: true });
      if (library.index) delete library.index[relativePath];
    }
    if (items.length === 0) throw new LibraryError("Photos not found.", 404);
    state.trash.unshift({ id, deletedAt: new Date().toISOString(), items });
    await saveState(library);
    return { batchId: id, trashed: items.map((item) => item.path) };
  });
}

export function restoreTrash(library, batchId) {
  return locked(library, async () => {
    const state = await loadState(library);
    const index = state.trash.findIndex((batch) => batch.id === batchId);
    if (index < 0) throw new LibraryError("Nothing to restore.", 404);
    const [batch] = state.trash.splice(index, 1);
    const restored = [];
    for (const item of batch.items) {
      const source = path.join(library.trashDir, batch.id, item.path);
      if (
        !(await stat(source)
          .then((info) => info.isFile())
          .catch(() => false))
      )
        continue;
      const folder = folderOf(item.path);
      const relativePath = await uniquePath(
        library.photosDir,
        folder,
        path.basename(item.path),
      );
      const target = path.join(library.photosDir, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      if (item.favorite) state.favorites.push(relativePath);
      if (item.override) state.overrides[relativePath] = item.override;
      restored.push(relativePath);
    }
    await rm(path.join(library.trashDir, batch.id), {
      recursive: true,
      force: true,
    });
    await saveState(library);
    library.index = null;
    await scan(library);
    return { restored };
  });
}

export function emptyTrash(library) {
  return locked(library, async () => {
    const state = await loadState(library);
    const count = state.trash.reduce(
      (total, batch) => total + batch.items.length,
      0,
    );
    state.trash = [];
    await rm(library.trashDir, { recursive: true, force: true });
    await saveState(library);
    return { emptied: count };
  });
}

export function setFavorite(library, relativePath, favorite) {
  return locked(library, async () => {
    if (!cleanRelativePath(relativePath))
      throw new LibraryError("Invalid photo path.");
    const state = await loadState(library);
    const has = state.favorites.includes(relativePath);
    if (favorite && !has) state.favorites.push(relativePath);
    if (!favorite && has)
      state.favorites = state.favorites.filter(
        (entry) => entry !== relativePath,
      );
    await saveState(library);
    return { favorite: Boolean(favorite) };
  });
}

const MAX_TAGS = 16;

function cleanTags(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map((tag) => cleanText(tag).toLowerCase().slice(0, 40))
    .filter((tag) => tag && !seen.has(tag) && seen.add(tag))
    .slice(0, MAX_TAGS);
}

export function setOverride(library, relativePath, patch) {
  return locked(library, async () => {
    if (!cleanRelativePath(relativePath))
      throw new LibraryError("Invalid photo path.");
    const state = await loadState(library);
    const current = { ...(state.overrides[relativePath] || {}) };
    if (Object.hasOwn(patch, "title")) {
      const title = cleanText(patch.title).slice(0, 200);
      if (title) current.title = title;
      else delete current.title;
    }
    if (Object.hasOwn(patch, "caption")) {
      const caption = String(patch.caption || "")
        .trim()
        .slice(0, 2000);
      if (caption) current.caption = caption;
      else delete current.caption;
    }
    if (Object.hasOwn(patch, "tags")) {
      const tags = cleanTags(patch.tags);
      if (tags.length) current.tags = tags;
      else delete current.tags;
    }
    if (patch.reset)
      for (const key of Object.keys(current)) delete current[key];
    if (Object.keys(current).length) state.overrides[relativePath] = current;
    else delete state.overrides[relativePath];
    await saveState(library);
    return { override: state.overrides[relativePath] || null };
  });
}

function cleanAlbumName(value) {
  return cleanText(value).slice(0, 120);
}

function cleanPaths(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(cleanRelativePath)
    .filter((entry) => entry && !seen.has(entry) && seen.add(entry));
}

export function createAlbum(library, body) {
  return locked(library, async () => {
    const name = cleanAlbumName(body?.name);
    if (!name) throw new LibraryError("Album name is required.");
    const state = await loadState(library);
    const now = new Date().toISOString();
    const album = {
      id: state.nextAlbumId,
      name,
      paths: cleanPaths(body?.paths),
      createdAt: now,
      updatedAt: now,
    };
    state.nextAlbumId += 1;
    state.albums.push(album);
    await saveState(library);
    return { album };
  });
}

export function updateAlbum(library, id, body) {
  return locked(library, async () => {
    const state = await loadState(library);
    const album = state.albums.find((entry) => entry.id === id);
    if (!album) throw new LibraryError("Album not found.", 404);
    if (Object.hasOwn(body, "name")) {
      const name = cleanAlbumName(body.name);
      if (!name) throw new LibraryError("Album name is required.");
      album.name = name;
    }
    if (Object.hasOwn(body, "paths")) album.paths = cleanPaths(body.paths);
    if (Array.isArray(body.add))
      album.paths = cleanPaths([...album.paths, ...body.add]);
    if (Array.isArray(body.remove)) {
      const gone = new Set(body.remove.map(cleanRelativePath));
      album.paths = album.paths.filter((entry) => !gone.has(entry));
    }
    album.updatedAt = new Date().toISOString();
    await saveState(library);
    return { album };
  });
}

export function deleteAlbum(library, id) {
  return locked(library, async () => {
    const state = await loadState(library);
    const index = state.albums.findIndex((entry) => entry.id === id);
    if (index < 0) throw new LibraryError("Album not found.", 404);
    const [deleted] = state.albums.splice(index, 1);
    await saveState(library);
    return { deleted };
  });
}
