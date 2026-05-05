#!/usr/bin/env node

/**
 * Mechanical verification script for SKILL.md (S02 slice).
 *
 * Checks:
 *  1. File exists and is non-empty
 *  2. YAML frontmatter present with `name: use-microsoft-todo`
 *  3. All XML body sections present and balanced
 *  4. At least 18 tool reference cards (≥17 tools)
 *  5. At least 4 recipe blocks
 *  6. At least 6 token-reduction patterns
 *  7. All 6 error codes present in troubleshooting
 *  8. No TBD/TODO/FIXME markers
 *  9. No markdown headings (# / ##) in body — XML-only structure
 */

import { readFileSync, existsSync } from "fs"

const SKILL_PATH = ".agents/skills/use-microsoft-todo/SKILL.md"

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✅ ${message}`)
  } else {
    failed++
    console.error(`  ❌ ${message}`)
  }
}

// ── 1. File exists and is non-empty ──────────────────────────────────
console.log("\n1. File existence")
assert(existsSync(SKILL_PATH), "SKILL.md exists")

const content = readFileSync(SKILL_PATH, "utf8")
assert(content.length > 0, "SKILL.md is non-empty")

// ── 2. YAML frontmatter ─────────────────────────────────────────────
console.log("\n2. YAML frontmatter")
const hasFrontmatter = content.startsWith("---")
assert(hasFrontmatter, "Starts with --- frontmatter delimiter")

const fmClose = content.indexOf("---", 3)
assert(fmClose > 3, "Frontmatter has closing --- delimiter")

const frontmatter = content.slice(0, fmClose)
assert(frontmatter.includes("name: use-microsoft-todo"), "Frontmatter contains name: use-microsoft-todo")

const body = content.slice(fmClose + 3)

// ── 3. XML body sections present and balanced ────────────────────────
console.log("\n3. XML body sections")
const sections = [
  "objective",
  "triggers",
  "conventions",
  "token_reduction",
  "success_criteria",
  "tool_reference",
  "workflow_recipes",
  "troubleshooting",
  "auth_diagnostics",
]

for (const tag of sections) {
  const openTag = `<${tag}>`
  const closeTag = `</${tag}>`
  assert(content.includes(openTag), `Opening tag <${tag}> present`)
  assert(content.includes(closeTag), `Closing tag </${tag}> present`)
  // Verify balanced (opening before closing)
  const openIdx = content.indexOf(openTag)
  const closeIdx = content.indexOf(closeTag)
  assert(openIdx < closeIdx, `Tag <${tag}> is balanced (open before close)`)
}

// ── 4. Tool reference cards (≥18) ────────────────────────────────────
console.log("\n4. Tool reference cards")
const toolCards = content.match(/<tool>\n/g) || []
assert(toolCards.length >= 18, `At least 18 tool cards found (found ${toolCards.length})`)

// ── 5. Recipe blocks (≥4) ────────────────────────────────────────────
console.log("\n5. Workflow recipes")
const recipeBlocks = content.match(/<recipe>/g) || []
assert(recipeBlocks.length >= 4, `At least 4 recipe blocks found (found ${recipeBlocks.length})`)

// ── 6. Token reduction patterns (≥6) ─────────────────────────────────
console.log("\n6. Token reduction patterns")
const tokenSection = content.slice(content.indexOf("<token_reduction>"), content.indexOf("</token_reduction>"))
const patterns = tokenSection.match(/\*\*\d+\./g) || []
assert(patterns.length >= 6, `At least 6 numbered patterns found (found ${patterns.length})`)

// ── 7. All 6 error codes in troubleshooting ──────────────────────────
console.log("\n7. Error codes in troubleshooting")
const errorCodes = [
  "AUTH_ERROR",
  "MAILBOX_NOT_ENABLED",
  "PERMISSION_DENIED",
  "GRAPH_API_ERROR",
  "NETWORK_ERROR",
  "VALIDATION_ERROR",
]

const troubleshootSection = content.slice(content.indexOf("<troubleshooting>"), content.indexOf("</troubleshooting>"))

for (const code of errorCodes) {
  assert(troubleshootSection.includes(code), `Error code ${code} present in troubleshooting`)
}

// ── 8. No TBD/TODO/FIXME markers ─────────────────────────────────────
console.log("\n8. No placeholder markers")
const markerMatch = content.match(/\b(TBD|TODO|FIXME)\b/g)
assert(
  markerMatch === null,
  `No TBD/TODO/FIXME markers found${markerMatch ? ` (found: ${markerMatch.join(", ")})` : ""}`,
)

// ── 9. No markdown headings in body ──────────────────────────────────
console.log("\n9. XML-only structure (no markdown headings in body)")
// Allow markdown headings inside XML blocks (e.g. ### Authentication), but
// the top-level body should not have # or ## headings outside XML tags.
// We check for lines that start with # or ## that are NOT inside an XML block.
const bodyLines = body.split("\n")
let inXmlBlock = false
let topLevelHeadings = []

for (const line of bodyLines) {
  const trimmed = line.trimStart()
  // Track XML block nesting
  if (/^<[a-z_]+>/.test(trimmed)) inXmlBlock = true
  if (/^<\/[a-z_]+>/.test(trimmed)) inXmlBlock = false

  if (!inXmlBlock && /^(#{1,2})\s/.test(trimmed)) {
    topLevelHeadings.push(trimmed)
  }
}

assert(
  topLevelHeadings.length === 0,
  `No top-level markdown headings in body${
    topLevelHeadings.length ? ` (found: ${topLevelHeadings.map((h) => h.slice(0, 40)).join("; ")})` : ""
  }`,
)

// ── Summary ──────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(50))
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log("=".repeat(50))

if (failed > 0) {
  console.error("\n❌ VERIFICATION FAILED")
  process.exit(1)
}

console.log("\n✅ ALL CHECKS PASSED")
process.exit(0)
