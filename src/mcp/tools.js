import commands from "../cli/commands.js";

const path = {
  type: "string",
  description:
    "Photo path relative to the photos folder, exactly as photos_library_list returns it (forward slashes, no dot segments).",
};
const paths = {
  type: "array",
  items: { type: "string" },
  description: "Photo paths, as returned by photos_library_list.",
};
const output = {
  type: "string",
  description:
    "Save the bytes to this local file path (on the machine running the app) instead of returning them.",
};
const tags = {
  type: ["array", "string"],
  items: { type: "string" },
  description:
    "Tags as a list or comma-separated string. An empty list clears them.",
};

export default {
  ...commands,
  title: "Photos",
  instructions: `
Tools for the photos app: a photo library that is a folder of image files on
disk, plus favorites, titles, captions, tags and albums kept beside it. Paths
are always relative to the photos folder and come from photos_library_list;
uploads are filed under YYYY/YYYY-MM-DD by the date taken, so use the path the
upload returns. Trashing is reversible with the batchId it returns until
photos_trash_empty runs.`,
  tools: {
    "library list": {
      title: "List library",
      description:
        "Every photo (newest first) with its metadata, favorites, the albums, and the trash batches.",
      inputSchema: {
        type: "object",
        properties: {
          rescan: { type: "boolean", description: "Walk the folder first." },
        },
      },
    },
    rescan: {
      title: "Rescan folder",
      description:
        "Walk the photos folder again, picking up files added outside the app. force re-reads metadata for every file.",
      inputSchema: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "Re-read every file, not only the changed ones.",
          },
        },
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "file get": {
      title: "Get photo bytes",
      description:
        "The photo itself. Images up to 3 MB come back inline; larger ones come back as a link to the API. output saves the file locally instead.",
      inputSchema: { type: "object", properties: { path, output } },
      download: true,
    },
    "thumb get": {
      title: "Get preview",
      description:
        "The embedded preview when the file has one (JPEG), otherwise the file itself. The cheap way to look at a photo.",
      inputSchema: { type: "object", properties: { path, output } },
      download: true,
    },
    upload: {
      title: "Upload photos",
      description:
        "Add image files from the local disk (paths on the machine running the app). Returns the library paths under uploaded and any refused files under rejected.",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths of images to add.",
          },
        },
        required: ["files"],
      },
      annotations: { destructiveHint: false },
    },
    "photo update": {
      title: "Update photo",
      description:
        "Set a photo's title, caption or tags. Passing an empty value clears that field; reset clears all three.",
      inputSchema: {
        type: "object",
        properties: {
          path,
          title: { type: "string", description: "Up to 200 characters." },
          caption: { type: "string", description: "Up to 2000 characters." },
          tags,
          reset: { type: "boolean", description: "Clear every override." },
        },
        required: ["path"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "photo trash": {
      title: "Trash photos",
      description:
        "Move photos to the trash as one batch. Returns the batchId that photos_trash_restore takes.",
      inputSchema: {
        type: "object",
        properties: { paths },
        required: ["paths"],
      },
      query: { paths: "path" },
      annotations: { destructiveHint: false },
    },
    "favorite set": {
      title: "Set favorite",
      description: "Mark or unmark a photo as a favorite.",
      inputSchema: {
        type: "object",
        properties: {
          path,
          favorite: {
            type: "boolean",
            description: "Defaults to true; false removes the favorite.",
          },
        },
        required: ["path"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "albums create": {
      title: "Create album",
      description: "Create an album, optionally with photos in it.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Album name." },
          paths,
        },
        required: ["name"],
      },
      annotations: { destructiveHint: false },
    },
    "albums update": {
      title: "Update album",
      description:
        "Rename an album, replace its photos with paths, or change them with add and remove.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Album id." },
          name: { type: "string" },
          paths: { ...paths, description: "Replace the album's photos." },
          add: { ...paths, description: "Photos to add." },
          remove: { ...paths, description: "Photos to remove." },
        },
        required: ["id"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "albums delete": {
      title: "Delete album",
      description: "Delete an album. The photos stay in the library.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", description: "Album id." } },
        required: ["id"],
      },
    },
    "trash restore": {
      title: "Restore from trash",
      description: "Put a trashed batch back where it came from.",
      inputSchema: {
        type: "object",
        properties: {
          batchId: {
            type: "string",
            description:
              "The batchId from photos_photo_trash or the library's trash list.",
          },
        },
        required: ["batchId"],
      },
      annotations: { destructiveHint: false },
    },
    "trash empty": {
      title: "Empty trash",
      description:
        "Permanently delete everything in the trash. Cannot be undone.",
      inputSchema: { type: "object", properties: {} },
    },
  },
};
