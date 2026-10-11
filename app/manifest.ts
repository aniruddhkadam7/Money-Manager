import type { MetadataRoute } from "next";

/** Lets "Add to Home Screen" open the app full screen, without the browser's address and tab bars. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Money Manager",
    short_name: "Money",
    description: "A simple personal expense tracker.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
