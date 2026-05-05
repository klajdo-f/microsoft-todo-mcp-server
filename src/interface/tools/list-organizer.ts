/**
 * List organisation helpers extracted from list-tools.ts.
 *
 * Pure functions that categorise, sort, and format task lists into a
 * hierarchical organised view.  No MCP or Graph API dependencies —
 * these operate on domain entity types only.
 */
import type { TaskList } from "../../domain/entities.js"

// ---------------------------------------------------------------------------
// Category patterns
// ---------------------------------------------------------------------------

/** Regex patterns used to assign a list to a category by display name. */
const CATEGORY_PATTERNS = {
  archived: /\(([^)]+)\s*-\s*Archived\)$/i,
  archive: /^📦\s*Archive/i,
  shopping: /^🛒/,
  property: /^🏡/,
  family: /^👪/,
  seasonal: /^(🎄|🎉)/,
  work: /^(Work|SBIR)/i,
  travel: /^(🚗|Rangeley)/i,
  reading: /^📰/,
} as const

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Category display-order mapping (lower number = higher priority). */
export const CATEGORY_PRIORITY: Record<string, number> = {
  "⭐ Special Lists": 1,
  "👥 Shared Lists": 2,
  "💼 Work": 3,
  "👪 Family": 4,
  "🏡 Properties": 5,
  "🛒 Shopping Lists": 6,
  "🚗 Travel & Rangeley": 7,
  "🎉 Seasonal & Events": 8,
  "📚 Reading": 9,
  "📋 Other Lists": 10,
  "📦 Archives": 11,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Organise lists into categories based on naming patterns, emoji prefixes,
 * and sharing status.
 */
export function organizeLists(lists: TaskList[]): Record<string, TaskList[]> {
  const organized: Record<string, TaskList[]> = {}

  for (const list of lists) {
    const category = categorizeList(list)
    if (!organized[category]) organized[category] = []
    organized[category].push(list)
  }

  return organized
}

/**
 * Sort category keys by display priority (archived categories sink to the
 * bottom, then by CATEGORY_PRIORITY ordinal, then alphabetical).
 */
export function sortCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const aArchived = a.startsWith("📦 Archived -")
    const bArchived = b.startsWith("📦 Archived -")

    if (aArchived && !bArchived) return 1
    if (!aArchived && bArchived) return -1
    if (aArchived && bArchived) return a.localeCompare(b)

    const aPriority = CATEGORY_PRIORITY[a] ?? 999
    const bPriority = CATEGORY_PRIORITY[b] ?? 999
    if (aPriority !== bPriority) return aPriority - bPriority
    return a.localeCompare(b)
  })
}

/**
 * Build the full organised-view text output for `get-task-lists-organized`.
 */
export function buildOrganizedOutput(
  lists: TaskList[],
  organized: Record<string, TaskList[]>,
  includeIds?: boolean,
): string {
  const sortedCategories = sortCategories(Object.keys(organized))

  let output = "📂 Microsoft To Do Lists - Organized View\n"
  output += "=".repeat(50) + "\n\n"

  for (const category of sortedCategories) {
    const categoryLists = organized[category]
    output += `${category} (${categoryLists.length})\n`

    categoryLists.forEach((list, index) => {
      const isLast = index === categoryLists.length - 1
      const prefix = isLast ? "└─" : "├─"

      let listInfo = `${prefix} ${list.displayName}`

      const metadata: string[] = []
      if (list.wellknownListName === "defaultList") metadata.push("Default")
      if (list.wellknownListName === "flaggedEmails") metadata.push("Flagged Emails")
      if (list.isShared && list.isOwner) metadata.push("Shared by you")
      if (list.isShared && !list.isOwner) metadata.push("Shared with you")

      if (metadata.length > 0) {
        listInfo += ` [${metadata.join(", ")}]`
      }

      output += `   ${listInfo}\n`
      if (!isLast) output += "   │\n"
    })

    output += "\n"
  }

  // Summary
  const totalLists = Object.values(organized).reduce((sum, l) => sum + l.length, 0)
  output += "-".repeat(50) + "\n"
  output += `Summary: ${totalLists} lists in ${Object.keys(organized).length} categories\n`

  if (includeIds) {
    output += "\n\n📋 List IDs Reference:\n" + "-".repeat(50) + "\n"
    for (const list of lists) {
      output += `${list.displayName}: ${list.id}\n`
    }
  }

  return output
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Assign a single list to a category string. */
function categorizeList(list: TaskList): string {
  const name = list.displayName

  const archiveMatch = name.match(CATEGORY_PATTERNS.archived)
  if (archiveMatch) return `📦 Archived - ${archiveMatch[1]}`
  if (CATEGORY_PATTERNS.archive.test(name)) return "📦 Archives"
  if (CATEGORY_PATTERNS.shopping.test(name)) return "🛒 Shopping Lists"
  if (CATEGORY_PATTERNS.property.test(name)) return "🏡 Properties"
  if (CATEGORY_PATTERNS.family.test(name)) return "👪 Family"
  if (CATEGORY_PATTERNS.seasonal.test(name)) return "🎉 Seasonal & Events"
  if (CATEGORY_PATTERNS.work.test(name)) return "💼 Work"
  if (CATEGORY_PATTERNS.travel.test(name)) return "🚗 Travel & Rangeley"
  if (CATEGORY_PATTERNS.reading.test(name)) return "📚 Reading"
  if (list.wellknownListName && list.wellknownListName !== "none") return "⭐ Special Lists"
  if (list.isShared) return "👥 Shared Lists"
  return "📋 Other Lists"
}
