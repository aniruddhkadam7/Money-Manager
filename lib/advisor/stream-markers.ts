/**
 * Markers in Friday's answer stream, shared by the server (lib/advisor/server.ts) and the page.
 * HEARTBEAT: sent while the AI thinks, before its first word, so the line never sits idle; invisible, and stripped.
 * STREAM_ERROR: starts the stream when the AI failed before any words; the rest is the message to show.
 */
export const HEARTBEAT = "⁠";
export const STREAM_ERROR = "\u0000ERROR:";
