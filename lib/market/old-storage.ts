/**
 * The old Market page kept throwaway copies of its data (economy, IBJA, charts, quotes) and its view
 * choices in this browser's localStorage. The page keeps nothing there now, so they're only taking room
 * that the app's own data shares: cleared once the Market page opens.
 */
const OLD_KEY = /^mm-market-(cache:|sort:|view$)/;

export function dropOldMarketStorage(storage: Storage): number {
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && OLD_KEY.test(key)) old.push(key);
  }
  old.forEach((key) => storage.removeItem(key));
  return old.length;
}
