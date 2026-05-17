/**
 * Extract the target file path from tool arguments.
 * Pure function — no side effects.
 */
export function extractFilePath(tool: string, args: unknown): string | null {
  if (typeof args !== 'object' || args === null) {
    return null
  }

  const a = args as Record<string, unknown>

  // Known tool-specific fields
  if (tool === 'edit' && typeof a.filePath === 'string' && a.filePath.length > 0) {
    return a.filePath
  }

  if (tool === 'write' && typeof a.file === 'string' && a.file.length > 0) {
    return a.file
  }

  // Generic fallback for custom tools
  // Tries common field names in priority order
  for (const field of ['filePath', 'file', 'path', 'file_path']) {
    const value = a[field]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return null
}
