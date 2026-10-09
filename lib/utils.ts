import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Scrolls the page: the window on desktop, the body on touch screens (it's the scroller there, see globals.css). */
export function scrollPage(options: ScrollToOptions) {
  window.scrollTo(options);
  document.body.scrollTo(options);
}
