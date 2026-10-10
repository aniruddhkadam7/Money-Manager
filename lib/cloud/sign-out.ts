import { supabase } from "./client";
import { stopSync } from "./sync";

/**
 * Signs out once every change has reached the cloud, then reloads to the sign-in screen. Returns false,
 * still signed in, when something couldn't be uploaded: signing out then would lose it.
 */
export async function signOut(): Promise<boolean> {
  try {
    await stopSync();
  } catch {
    window.alert("Some changes haven't reached the cloud yet, so signing out now would lose them. Check your connection and try again.");
    return false;
  }
  await supabase()?.auth.signOut();
  window.location.href = "/";
  return true;
}
