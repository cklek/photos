export const GROUPS = ["day", "month", "folder", "none"];
export const SORTS = ["newest", "oldest", "name", "size"];

const GROUP_LABELS = {
  day: "Day",
  month: "Month",
  folder: "Folder",
  none: "Nothing",
};
const SORT_LABELS = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name",
  size: "Largest first",
};

export const groupLabel = (value) => GROUP_LABELS[value] || value;
export const sortLabel = (value) => SORT_LABELS[value] || value;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
  }).format(date);
}

export function formatDimensions(photo) {
  if (!photo.width || !photo.height) return "Unknown";
  const megapixels = (photo.width * photo.height) / 1_000_000;
  return `${photo.width} × ${photo.height} (${megapixels.toFixed(1)} MP)`;
}

export function formatShutter(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}`;
}

export function formatExposure(photo) {
  const shutter = formatShutter(photo.shutter);
  return [
    photo.focalLength ? `${Math.round(photo.focalLength)}mm` : null,
    photo.aperture ? `f/${Number(photo.aperture.toFixed(1))}` : null,
    shutter,
    photo.iso ? `ISO ${photo.iso}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function searchPhotos(photos, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return photos;
  const words = needle.split(/\s+/);
  return photos.filter((photo) => {
    const haystack = [
      photo.path,
      photo.title,
      photo.caption,
      photo.camera,
      photo.lens,
      photo.tags.join(" "),
      photo.date?.slice(0, 10),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function sortPhotos(photos, sort) {
  const sorted = photos.slice();
  if (sort === "oldest")
    sorted.sort(
      (a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path),
    );
  else if (sort === "name")
    sorted.sort(
      (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
    );
  else if (sort === "size") sorted.sort((a, b) => b.size - a.size);
  else
    sorted.sort(
      (a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path),
    );
  return sorted;
}

export function groupPhotos(photos, group) {
  if (group === "none" || photos.length === 0)
    return [{ key: "all", label: "", photos }];
  const sections = [];
  let current = null;
  for (const photo of photos) {
    const key =
      group === "folder"
        ? photo.folder || "Loose photos"
        : group === "month"
          ? photo.date.slice(0, 7)
          : photo.date.slice(0, 10);
    if (!current || current.key !== key) {
      current = {
        key,
        label:
          group === "folder"
            ? key
            : group === "month"
              ? formatMonth(photo.date)
              : formatDay(photo.date),
        photos: [],
      };
      sections.push(current);
    }
    current.photos.push(photo);
  }
  return sections;
}
