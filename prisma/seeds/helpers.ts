import type { SimploErrorInfo } from "../../src/shared/simplo/types.js"

export function formatError({ status, detail, errors }: SimploErrorInfo) {
  const lines = [`(${status}) ${detail}`]
  if (errors) {
    for (const { pointer, detail: fieldDetail } of errors) {
      lines.push(`  → ${pointer}: ${fieldDetail}`)
    }
  }
  return lines.join("\n")
}
