/** Lists file names left in `dir` — chunks orphaned by a session that never closed cleanly. */
export async function listarOrfaos(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const name of dir.keys()) {
    names.push(name)
  }
  return names
}
