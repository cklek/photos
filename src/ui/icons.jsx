import {
  IconCheck as TablerIconCheck,
  IconChevronLeft as TablerIconChevronLeft,
  IconChevronRight as TablerIconChevronRight,
  IconCopy as TablerIconCopy,
  IconDownload as TablerIconDownload,
  IconMaximize as TablerIconMaximize,
  IconPhoto as TablerIconPhoto,
  IconRefresh as TablerIconRefresh,
  IconSearch as TablerIconSearch,
  IconStar as TablerIconStar,
  IconStarFilled as TablerIconStarFilled,
  IconTrash as TablerIconTrash,
  IconUpload as TablerIconUpload,
  IconX as TablerIconX,
} from "@tabler/icons-react";

function at16(Icon) {
  const Sized = (props) => <Icon size={16} {...props} />;
  Sized.displayName = Icon.displayName || Icon.name;
  return Sized;
}

export const IconCheck = at16(TablerIconCheck);
export const IconChevronLeft = at16(TablerIconChevronLeft);
export const IconChevronRight = at16(TablerIconChevronRight);
export const IconCopy = at16(TablerIconCopy);
export const IconDownload = at16(TablerIconDownload);
export const IconMaximize = at16(TablerIconMaximize);
export const IconPhoto = at16(TablerIconPhoto);
export const IconRefresh = at16(TablerIconRefresh);
export const IconSearch = at16(TablerIconSearch);
export const IconStar = at16(TablerIconStar);
export const IconStarFilled = at16(TablerIconStarFilled);
export const IconTrash = at16(TablerIconTrash);
export const IconUpload = at16(TablerIconUpload);
export const IconX = at16(TablerIconX);
