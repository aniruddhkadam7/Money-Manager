// No React here: the root layout (a Server Component) imports this.

/** Per device (not mirrored to the cloud): a phone can be dark while a laptop stays light. */
export const THEME_KEY = "mm-theme";

/**
 * Runs in <head> before first paint (app/layout.tsx), so a dark page never flashes white. Kept in sync with
 * applyTheme in ./theme.ts.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
