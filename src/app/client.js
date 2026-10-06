async function request(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const jsonInit = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const query = (paths) =>
  paths.map((path) => `path=${encodeURIComponent(path)}`).join("&");

export const fetchLibrary = () => request("/api/library");
export const rescanLibrary = (force = false) =>
  request(`/api/rescan${force ? "?force=1" : ""}`, { method: "POST" });
export const setFavorite = (path, favorite) =>
  request("/api/favorite", jsonInit("POST", { path, favorite }));
export const updatePhoto = (path, patch) =>
  request("/api/photo", jsonInit("PATCH", { path, ...patch }));
export const trashPhotos = (paths) =>
  request(`/api/photo?${query(paths)}`, { method: "DELETE" });
export const restoreTrash = (batchId) =>
  request("/api/trash", jsonInit("POST", { batchId }));
export const emptyTrash = () => request("/api/trash", { method: "DELETE" });
export const createAlbum = (name, paths = []) =>
  request("/api/albums", jsonInit("POST", { name, paths }));
export const updateAlbum = (id, patch) =>
  request(`/api/albums/${id}`, jsonInit("PATCH", patch));
export const deleteAlbum = (id) =>
  request(`/api/albums/${id}`, { method: "DELETE" });

export function uploadFiles(files) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return request("/api/upload", { method: "POST", body: form });
}
