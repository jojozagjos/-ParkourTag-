// Simple in-memory registry to remember player names by socket id across screens
const nameMap = new Map<string, string>()

export function rememberName(id: string, name?: string) {
  if (!id) return
  const trimmed = (name || '').trim()
  if (trimmed) nameMap.set(id, trimmed)
}

export function rememberMany(entries: Array<{ id: string; name?: string }>) {
  for (const e of entries) rememberName(e.id, e.name)
}

export function lookupName(id: string): string | undefined {
  return nameMap.get(id)
}

export function clearNames() {
  nameMap.clear()
}
