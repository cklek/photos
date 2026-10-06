import { useEffect } from "react";
import { Button } from "@/ui/button";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconStar,
  IconStarFilled,
  IconX,
} from "@/ui/icons";
import { cn } from "@/lib/utils";
import { formatDate, formatDimensions, formatExposure } from "./library";

export function Lightbox({
  photo,
  index,
  total,
  onClose,
  onPrevious,
  onNext,
  onToggleFavorite,
}) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        onToggleFavorite();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onPrevious, onNext, onToggleFavorite]);

  if (!photo) return null;
  const exposure = formatExposure(photo);
  const Star = photo.favorite ? IconStarFilled : IconStar;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      onClick={onClose}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-2 rule-b px-3"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate">{photo.title}</span>
        <span className="shrink-0 text-muted-foreground">
          {index + 1}/{total}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={photo.favorite ? "Unfavourite" : "Favourite"}
          aria-label={photo.favorite ? "Unfavourite" : "Favourite"}
          onClick={onToggleFavorite}
          className={cn(
            "grid size-8 place-items-center border border-border",
            photo.favorite && "border-foreground text-foreground",
          )}
        >
          <Star className="size-4" />
        </Button>
        <a
          href={photo.url}
          download={photo.name}
          title="Download"
          aria-label="Download"
          className="grid size-8 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconDownload className="size-4" />
        </a>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Close"
          aria-label="Close"
          onClick={onClose}
          className="grid size-8 place-items-center border border-border"
        >
          <IconX className="size-4" />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        {total > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Previous"
            aria-label="Previous"
            onClick={(event) => {
              event.stopPropagation();
              onPrevious();
            }}
            className="absolute left-3 z-10 grid size-8 place-items-center border border-border bg-background/80"
          >
            <IconChevronLeft className="size-4" />
          </Button>
        ) : null}
        <img
          src={photo.url}
          alt={photo.caption || photo.title}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
        {total > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Next"
            aria-label="Next"
            onClick={(event) => {
              event.stopPropagation();
              onNext();
            }}
            className="absolute right-3 z-10 grid size-8 place-items-center border border-border bg-background/80"
          >
            <IconChevronRight className="size-4" />
          </Button>
        ) : null}
      </div>

      <footer
        className="shrink-0 rule-t px-3 py-2"
        onClick={(event) => event.stopPropagation()}
      >
        {photo.caption ? (
          <p className="text-foreground">{photo.caption}</p>
        ) : null}
        <p className="text-muted-foreground">
          {[
            formatDate(photo.date),
            formatDimensions(photo),
            photo.camera,
            exposure,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
      </footer>
    </div>
  );
}
