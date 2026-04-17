/**
 * Strip Electron's IPC-wrapper prefix from an error thrown through
 * `ipcRenderer.invoke`. Electron prepends
 *   "Error invoking remote method 'channel:name': Error: "
 * to whatever the main-process handler threw.
 */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}
