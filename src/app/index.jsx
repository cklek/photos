import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/shell/layout";
import { useAppMenu } from "@/shell/menu-context";
import { themeViewItems, useTheme } from "@/lib/theme";
import { useAppDialog } from "@/shell/dialog";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { Textarea } from "@/ui/textarea";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconMaximize,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUpload,
  IconX,
} from "@/ui/icons";
import { useSearchParam, useUpdateSearchParams } from "@/lib/url-query-state";
import { cn } from "@/lib/utils";
import {
  emptyTrash,
  fetchLibrary,
  rescanLibrary,
  restoreTrash,
  setFavorite,
  trashPhotos,
  updatePhoto,
  uploadFiles,
} from "./client";
import {
  GROUPS,
  SORTS,
  formatBytes,
  formatDate,
  formatDimensions,
  formatExposure,
  groupLabel,
  groupPhotos,
  searchPhotos,
  sortLabel,
  sortPhotos,
} from "./library";
import { Lightbox } from "./lightbox";

const EMPTY = [];

function enumParam(value, allowed, fallback) {
  return value && allowed.includes(value) ? value : fallback;
}

/* Menus are contributed from inside the layout, where the provider lives:
 * File uploads and rescans the folder, Edit works on the selection, View
 * decides how the grid is cut up and ordered. */
function PhotoMenus({
  fileInputRef,
  rescan,
  trashCount,
  discardTrash,
  visible,
  selectAll,
  selected,
  clearSelection,
  focused,
  toggleFavorite,
  targetPaths,
  remove,
  group,
  sort,
  favoritesOnly,
  updateQuery,
}) {
  const theme = useTheme();
  useAppMenu(
    {
      file: [
        {
          id: "upload",
          label: "Upload…",
          shortcut: "⌘U",
          onSelect: () => fileInputRef.current?.click(),
        },
        {
          id: "rescan",
          label: "Rescan folder",
          shortcut: "⌘R",
          onSelect: () => void rescan(false),
        },
        {
          id: "reread",
          label: "Read every file again",
          onSelect: () => void rescan(true),
        },
        { kind: "separator", id: "file-sep" },
        {
          id: "empty-trash",
          label: trashCount ? `Empty trash (${trashCount})…` : "Empty trash",
          disabled: trashCount === 0,
          variant: "destructive",
          onSelect: () => void discardTrash(),
        },
      ],
      edit: [
        {
          id: "select-all",
          label: "Select all",
          shortcut: "⌘A",
          disabled: visible.length === 0,
          onSelect: selectAll,
        },
        {
          id: "clear",
          label: "Clear selection",
          shortcut: "Esc",
          disabled: selected.size === 0,
          onSelect: clearSelection,
        },
        { kind: "separator", id: "edit-sep" },
        {
          id: "favorite",
          label: focused?.favorite ? "Remove favourite" : "Favourite",
          shortcut: "F",
          disabled: !focused,
          onSelect: () => void toggleFavorite(focused),
        },
        {
          id: "delete",
          label:
            targetPaths.length > 1
              ? `Move ${targetPaths.length} to trash`
              : "Move to trash",
          shortcut: "⌫",
          disabled: targetPaths.length === 0,
          variant: "destructive",
          onSelect: () => void remove(targetPaths),
        },
      ],
      view: [
        { kind: "label", id: "group-label", label: "Group by" },
        ...GROUPS.map((value) => ({
          kind: "checkbox",
          id: `group-${value}`,
          label: groupLabel(value),
          checked: group === value,
          onSelect: () => updateQuery({ group: value }),
        })),
        { kind: "separator", id: "view-sep-1" },
        { kind: "label", id: "sort-label", label: "Sort by" },
        ...SORTS.map((value) => ({
          kind: "checkbox",
          id: `sort-${value}`,
          label: sortLabel(value),
          checked: sort === value,
          onSelect: () => updateQuery({ sort: value }),
        })),
        { kind: "separator", id: "view-sep-2" },
        {
          kind: "checkbox",
          id: "favorites-only",
          label: "Favourites only",
          checked: favoritesOnly,
          onSelect: () => updateQuery({ fav: favoritesOnly ? null : "1" }),
        },
        { id: "theme-sep", kind: "separator" },
        ...themeViewItems(theme),
      ],
    },
    [
      theme.id,
      group,
      sort,
      favoritesOnly,
      visible.length,
      selected.size,
      focused,
      targetPaths.length,
      trashCount,
      selectAll,
      clearSelection,
      toggleFavorite,
      remove,
      rescan,
      discardTrash,
      updateQuery,
    ],
  );
  return null;
}

export default function PhotosPage() {
  const dialog = useAppDialog();
  const updateQuery = useUpdateSearchParams();
  const group = enumParam(useSearchParam("group"), GROUPS, "day");
  const sort = enumParam(useSearchParam("sort"), SORTS, "newest");
  const favoritesOnly = useSearchParam("fav") === "1";
  const focusedPath = useSearchParam("photo");
  const queryParam = useSearchParam("q") || "";

  const [library, setLibrary] = useState(null);
  const [query, setQuery] = useState(queryParam);
  const [selected, setSelected] = useState(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const fileInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const lastToggledIndexRef = useRef(null);

  const photos = library?.photos || EMPTY;
  const trash = library?.trash || EMPTY;

  const visible = useMemo(() => {
    const matching = searchPhotos(
      favoritesOnly ? photos.filter((photo) => photo.favorite) : photos,
      query,
    );
    return sortPhotos(matching, sort);
  }, [photos, query, favoritesOnly, sort]);
  const sections = useMemo(() => groupPhotos(visible, group), [visible, group]);
  const focusedIndex = useMemo(
    () => visible.findIndex((photo) => photo.path === focusedPath),
    [visible, focusedPath],
  );
  const focused = focusedIndex >= 0 ? visible[focusedIndex] : null;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoading(true);
    try {
      setLibrary(await fetchLibrary());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setQuery(queryParam);
  }, [queryParam]);

  /* A photo that has left the visible list should not stay focused; fall
   * back to the first one so the panel is never blank for no reason. This
   * waits for the library, or a bookmarked ?photo= would be cleared for
   * missing from a list that has not arrived yet. */
  useEffect(() => {
    if (!library) return;
    if (visible.length === 0) {
      if (focusedPath) updateQuery({ photo: null });
      return;
    }
    if (focusedIndex < 0) updateQuery({ photo: visible[0].path });
  }, [library, visible, focusedIndex, focusedPath, updateQuery]);

  const focus = useCallback(
    (photo) => updateQuery({ photo: photo?.path || null }),
    [updateQuery],
  );

  const step = useCallback(
    (delta) => {
      if (visible.length === 0) return;
      const next =
        (focusedIndex < 0 ? 0 : focusedIndex + delta + visible.length) %
        visible.length;
      focus(visible[next]);
    },
    [visible, focusedIndex, focus],
  );

  const clearSelection = useCallback(() => {
    setSelected((current) => (current.size === 0 ? current : new Set()));
    lastToggledIndexRef.current = null;
  }, []);

  const toggleSelect = useCallback(
    (path, index, shiftKey) => {
      setSelected((current) => {
        const next = new Set(current);
        if (shiftKey && lastToggledIndexRef.current != null) {
          const start = Math.min(lastToggledIndexRef.current, index);
          const end = Math.max(lastToggledIndexRef.current, index);
          const shouldSelect = !next.has(path);
          for (let i = start; i <= end; i += 1) {
            const rangePath = visible[i]?.path;
            if (!rangePath) continue;
            if (shouldSelect) next.add(rangePath);
            else next.delete(rangePath);
          }
        } else if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      lastToggledIndexRef.current = index;
    },
    [visible],
  );

  const selectAll = useCallback(() => {
    setSelected(new Set(visible.map((photo) => photo.path)));
  }, [visible]);

  const upload = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;
      setIsUploading(true);
      try {
        const result = await uploadFiles(files);
        if (result.uploaded.length > 0)
          toast.success(
            `${result.uploaded.length} photo${result.uploaded.length === 1 ? "" : "s"} added.`,
          );
        for (const rejected of result.rejected)
          toast.error(`${rejected.name}: ${rejected.error}`);
        await load({ silent: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed.");
      } finally {
        setIsUploading(false);
      }
    },
    [load],
  );

  const rescan = useCallback(
    async (force = false) => {
      try {
        const result = await rescanLibrary(force);
        await load({ silent: true });
        toast.success(
          `${result.count} photo${result.count === 1 ? "" : "s"} on disk` +
            (result.read ? `, ${result.read} newly read.` : "."),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Rescan failed.");
      }
    },
    [load],
  );

  const toggleFavorite = useCallback(async (photo) => {
    if (!photo) return;
    try {
      await setFavorite(photo.path, !photo.favorite);
      setLibrary((current) =>
        current
          ? {
              ...current,
              photos: current.photos.map((entry) =>
                entry.path === photo.path
                  ? { ...entry, favorite: !photo.favorite }
                  : entry,
              ),
            }
          : current,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed.");
    }
  }, []);

  const remove = useCallback(
    async (paths) => {
      if (paths.length === 0) return;
      try {
        const result = await trashPhotos(paths);
        clearSelection();
        await load({ silent: true });
        toast.success(
          `${result.trashed.length} photo${result.trashed.length === 1 ? "" : "s"} moved to trash.`,
          {
            action: {
              label: "Undo",
              onClick: () => {
                void restoreTrash(result.batchId)
                  .then(() => load({ silent: true }))
                  .then(() => toast.success("Photos restored."))
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Restore failed.",
                    ),
                  );
              },
            },
          },
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Delete failed.");
      }
    },
    [clearSelection, load],
  );

  const trashCount = useMemo(
    () => trash.reduce((total, batch) => total + batch.count, 0),
    [trash],
  );

  const discardTrash = useCallback(async () => {
    if (trashCount === 0) return;
    const confirmed = await dialog.confirm({
      title: `Delete ${trashCount} photo${trashCount === 1 ? "" : "s"} for good?`,
      description: "The files leave the disk. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      const result = await emptyTrash();
      await load({ silent: true });
      toast.success(`${result.emptied} deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed.");
    }
  }, [dialog, trashCount, load]);

  const targetPaths =
    selected.size > 0 ? [...selected] : focused ? [focused.path] : [];

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (typing) {
        if (event.key === "Escape") target.blur();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "u") {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      } else if (meta && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void rescan(false);
      } else if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (lightboxOpen) {
        /* The lightbox owns the arrows while it is open. */
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "Enter" || event.key === " ") {
        if (!focused) return;
        event.preventDefault();
        setLightboxOpen(true);
      } else if (event.key === "Escape") {
        clearSelection();
      } else if (event.key.toLowerCase() === "f") {
        void toggleFavorite(focused);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (targetPaths.length === 0) return;
        event.preventDefault();
        void remove(targetPaths);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    step,
    focused,
    selectAll,
    clearSelection,
    toggleFavorite,
    remove,
    rescan,
    targetPaths,
    lightboxOpen,
  ]);

  return (
    <AppLayout showHeader={false}>
      <PhotoMenus
        fileInputRef={fileInputRef}
        rescan={rescan}
        trashCount={trashCount}
        discardTrash={discardTrash}
        visible={visible}
        selectAll={selectAll}
        selected={selected}
        clearSelection={clearSelection}
        focused={focused}
        toggleFavorite={toggleFavorite}
        targetPaths={targetPaths}
        remove={remove}
        group={group}
        sort={sort}
        favoritesOnly={favoritesOnly}
        updateQuery={updateQuery}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/avif,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp"
        className="hidden"
        onChange={(event) => {
          if (event.currentTarget.files) void upload(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />

      <div
        className={cn(
          "grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]",
          isDragging && "bg-foreground/5",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <section className="flex min-h-0 flex-col rule-r">
          <header className="flex h-12 shrink-0 items-center gap-2 rule-b bg-background px-3">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-input bg-background px-2">
              <IconSearch className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  updateQuery({ q: event.target.value.trim() || null });
                }}
                placeholder="Search name, camera, caption, date"
                className="h-6 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="hidden h-8 max-w-64 shrink-0 items-center truncate border border-border px-2 text-muted-foreground sm:flex">
              {visible.length}/{photos.length} photos
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Rescan folder"
              aria-label="Rescan folder"
              onClick={() => void rescan(false)}
              className="grid size-8 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconRefresh className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Upload"
              aria-label="Upload"
              className="grid size-8 place-items-center border border-foreground bg-foreground text-background transition-opacity disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <IconUpload
                className={cn("size-4", isUploading && "animate-pulse")}
              />
            </Button>
          </header>

          {selected.size > 0 ? (
            <div className="flex h-12 shrink-0 items-center gap-2 rule-b bg-foreground/5 px-3">
              <span className="shrink-0">{selected.size} selected</span>
              <div className="ml-auto flex items-center gap-2">
                {selected.size < visible.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={selectAll}
                    className="h-8 border border-border px-2 transition-colors hover:border-foreground/40"
                  >
                    Select all ({visible.length})
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearSelection}
                  title="Clear selection"
                  className="flex h-8 items-center gap-1 border border-border px-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <IconX className="size-4" />
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void remove([...selected])}
                  title="Move to trash"
                  className="flex h-8 items-center gap-1 border border-destructive/40 px-2 text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconTrash className="size-4" />
                  Delete
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
              <div className="grid gap-4 cols-2 [--col-gap:16px] [--col-step:8px] sm:cols-3 lg:cols-4 2xl:cols-5">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div
                    key={index}
                    className="aspect-square animate-pulse bg-muted"
                  />
                ))}
              </div>
            </ScrollArea>
          ) : visible.length > 0 ? (
            <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
              {sections.map((section) => (
                <section key={section.key} className="mb-4 last:mb-0">
                  {section.label ? (
                    <h2 className="sticky top-0 z-10 -mx-3 mb-2 flex h-8 items-center gap-2 bg-background/95 px-3 text-muted-foreground backdrop-blur">
                      {section.label}
                      <span>{section.photos.length}</span>
                    </h2>
                  ) : null}
                  <div className="grid gap-4 cols-2 [--col-gap:16px] [--col-step:8px] sm:cols-3 lg:cols-4 2xl:cols-5">
                    {section.photos.map((photo) => (
                      <PhotoTile
                        key={photo.path}
                        photo={photo}
                        index={visible.indexOf(photo)}
                        isFocused={focused?.path === photo.path}
                        isSelected={selected.has(photo.path)}
                        selectionMode={selected.size > 0}
                        onFocus={() => focus(photo)}
                        onOpen={() => {
                          focus(photo);
                          setLightboxOpen(true);
                        }}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </ScrollArea>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
              <div className="grid justify-items-center gap-2">
                <IconPhoto className="size-8 text-muted-foreground" />
                <p>
                  {photos.length === 0 ? "No photos yet" : "Nothing matches"}
                </p>
                <p className="max-w-xs text-muted-foreground">
                  {photos.length === 0
                    ? `Drop images here, or put them in ${library?.photosDir || "the photos folder"} and rescan.`
                    : "Try a different search, or turn off favourites only."}
                </p>
              </div>
            </div>
          )}
        </section>

        <PhotoPanel
          photo={focused}
          onOpen={() => setLightboxOpen(true)}
          onToggleFavorite={() => void toggleFavorite(focused)}
          onDelete={() => focused && void remove([focused.path])}
          onSave={async (patch) => {
            if (!focused) return;
            try {
              await updatePhoto(focused.path, patch);
              await load({ silent: true });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed.");
            }
          }}
        />
      </div>

      {lightboxOpen && focused ? (
        <Lightbox
          photo={focused}
          index={focusedIndex}
          total={visible.length}
          onClose={() => setLightboxOpen(false)}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          onToggleFavorite={() => void toggleFavorite(focused)}
        />
      ) : null}
    </AppLayout>
  );
}

function PhotoTile({
  photo,
  index,
  isFocused,
  isSelected,
  selectionMode,
  onFocus,
  onOpen,
  onToggleSelect,
}) {
  return (
    <div className="group relative bg-card transition-colors">
      {/* The frame is a sibling over the picture rather than a border on the
       * tile: a border would take 2px off the square, and an inset ring on
       * the tile itself would be painted under the image. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-10 transition-colors",
          isSelected
            ? "inset-ring-2 inset-ring-foreground"
            : isFocused
              ? "inset-ring-1 inset-ring-foreground/70"
              : "inset-ring-1 inset-ring-border group-hover:inset-ring-foreground/40",
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        role="checkbox"
        aria-checked={isSelected}
        title={isSelected ? "Deselect" : "Select"}
        aria-label={isSelected ? "Deselect" : "Select"}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleSelect(photo.path, index, event.shiftKey);
        }}
        className={cn(
          "absolute top-2 left-2 z-10 grid size-6 place-items-center border shadow-sm transition-opacity",
          isSelected
            ? "border-foreground bg-foreground text-background opacity-100"
            : "border-border bg-background/85 text-transparent hover:text-foreground/40",
          !isSelected && !selectionMode && "opacity-0 group-hover:opacity-100",
        )}
      >
        <IconCheck className="size-4" />
      </Button>
      {photo.favorite ? (
        <span className="absolute top-2 right-2 z-10 grid size-6 place-items-center border border-foreground bg-background/85 text-foreground">
          <IconStarFilled className="size-4" />
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        onClick={onFocus}
        onDoubleClick={onOpen}
        title={photo.path}
        className="block h-auto w-full overflow-hidden p-0 text-left whitespace-normal"
      >
        <img
          src={photo.thumbUrl}
          alt={photo.caption || photo.title}
          loading="lazy"
          decoding="async"
          className="aspect-square w-full bg-muted object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div className="rule-t px-2 py-1">
          <p className="truncate">{photo.title}</p>
          <p className="truncate text-muted-foreground">
            {photo.width ? `${photo.width}×${photo.height}` : "—"} ·{" "}
            {formatBytes(photo.size)}
          </p>
        </div>
      </Button>
    </div>
  );
}

function Field({ label, children }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function PhotoPanel({ photo, onOpen, onToggleFavorite, onDelete, onSave }) {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    setTitle(photo?.title || "");
    setCaption(photo?.caption || "");
    setTags((photo?.tags || []).join(", "));
  }, [photo?.path, photo?.title, photo?.caption, photo?.tags]);

  if (!photo)
    return (
      <aside className="hidden min-h-0 flex-col bg-sidebar xl:flex">
        <div className="grid h-full place-items-center p-6 text-center text-muted-foreground">
          Select a photo.
        </div>
      </aside>
    );

  const exposure = formatExposure(photo);
  const Star = photo.favorite ? IconStarFilled : IconStar;
  const dirty =
    title !== photo.title ||
    caption !== (photo.caption || "") ||
    tags !== (photo.tags || []).join(", ");

  return (
    <aside className="hidden min-h-0 flex-col bg-sidebar xl:flex">
      <div className="relative rule-b p-3">
        <img
          src={photo.thumbUrl}
          alt={photo.caption || photo.title}
          className="aspect-square w-full bg-muted object-cover"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Open full size"
          aria-label="Open full size"
          onClick={onOpen}
          className="absolute right-5 bottom-5 grid size-8 place-items-center border border-border bg-background/85"
        >
          <IconMaximize className="size-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
        <label className="grid gap-2">
          <span>Title</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-8"
          />
        </label>
        <label className="mt-3 grid gap-2">
          <span>Caption</span>
          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What is happening here?"
            className="min-h-14"
          />
        </label>
        <label className="mt-3 grid gap-2">
          <span>Tags</span>
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="comma, separated"
            className="h-8"
          />
        </label>
        {dirty ? (
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                void onSave({ title, caption, tags: tags.split(",") })
              }
              className="h-8 flex-1 border border-foreground bg-foreground px-2 text-background"
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTitle(photo.title);
                setCaption(photo.caption || "");
                setTags((photo.tags || []).join(", "));
              }}
              className="h-8 border border-border px-2 text-muted-foreground"
            >
              Revert
            </Button>
          </div>
        ) : null}

        <dl className="mt-4 space-y-3">
          <Field label="File">{photo.path}</Field>
          <Field label="Taken">{formatDate(photo.date)}</Field>
          <Field label="Size">
            {`${formatDimensions(photo)} · ${formatBytes(photo.size)}`}
          </Field>
          <Field label="Camera">{photo.camera || null}</Field>
          <Field label="Lens">{photo.lens || null}</Field>
          <Field label="Exposure">{exposure || null}</Field>
          <Field label="Location">
            {photo.latitude != null
              ? `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`
              : null}
          </Field>
          <Field label="Type">{photo.contentType}</Field>
        </dl>
      </ScrollArea>

      <div className="flex gap-2 rule-t p-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleFavorite}
          title={photo.favorite ? "Remove favourite" : "Favourite"}
          className={cn(
            "flex h-8 items-center gap-1 border border-border px-2 transition-colors",
            photo.favorite
              ? "border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Star className="size-4" />
          {photo.favorite ? "Favourite" : "Favourite"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          title="Copy path"
          aria-label="Copy path"
          onClick={() => {
            void navigator.clipboard?.writeText(photo.path);
            toast.success("Path copied.");
          }}
          className="grid size-8 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconCopy className="size-4" />
        </Button>
        <a
          href={photo.url}
          download={photo.name}
          title="Download"
          aria-label="Download"
          className="grid size-8 shrink-0 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconDownload className="size-4" />
        </a>
        <Button
          type="button"
          variant="ghost"
          title="Move to trash"
          aria-label="Move to trash"
          onClick={onDelete}
          className="ml-auto grid size-8 place-items-center border border-destructive/40 text-destructive transition-colors hover:bg-destructive/10"
        >
          <IconTrash className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
