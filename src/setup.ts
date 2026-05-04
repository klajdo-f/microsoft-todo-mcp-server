#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import readline from "readline"
import { getTokenFilePath, getClaudeConfigPath, ensureConfigDir } from "./paths.js"
import { detectServerCommand, generateClaudeConfigEntry } from "./setup-config.js"

// Resolve the directory that contains this script's built output (dist/)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve))
}

async function setup() {
  console.log("🚀 Microsoft To Do MCP Server Setup")
  console.log("==================================\n")

  // Check if already configured
  const tokenPath = getTokenFilePath()

  if (existsSync(tokenPath)) {
    const answer = await question("Tokens already exist. Reconfigure? (y/N): ")
    if (answer.toLowerCase() !== "y") {
      console.log("Setup cancelled.")
      process.exit(0)
    }
  }

  // Check for Azure app credentials
  const hasEnvFile = existsSync(".env")

  if (!hasEnvFile) {
    console.log("\n📋 Azure App Registration Required")
    console.log("You need to create an app registration in Azure Portal first.")
    console.log("\nSteps:")
    console.log("1. Go to https://portal.azure.com")
    console.log("2. Navigate to 'App registrations' and create a new registration")
    console.log("3. Set redirect URI to: http://localhost:3000/callback")
    console.log("4. Add these API permissions: Tasks.Read, Tasks.ReadWrite, User.Read")
    console.log("5. Create a client secret\n")

    const clientId = await question("Enter your CLIENT_ID: ")
    const clientSecret = await question("Enter your CLIENT_SECRET: ")
    const tenantId = (await question("Enter your TENANT_ID (press Enter for 'organizations'): ")) || "organizations"

    // Create .env file
    const envContent = `CLIENT_ID=${clientId}
CLIENT_SECRET=${clientSecret}
TENANT_ID=${tenantId}
REDIRECT_URI=http://localhost:3000/callback
`
    writeFileSync(".env", envContent)
    console.log("✅ Created .env file")
  }

  console.log("\n🔐 Starting authentication flow...")
  console.log("A browser window will open. Please sign in with your Microsoft account.\n")

  // Ensure config dir exists so auth-server can write tokens
  ensureConfigDir()

  // Start the auth server, passing the token file path so it writes directly
  const authServerJs = join(__dirname, "auth-server.js")
  const authProcess = spawn("node", [authServerJs, "--token-file", tokenPath], {
    stdio: "inherit",
    shell: true,
  })

  authProcess.on("close", async (code) => {
    if (code === 0) {
      console.log("\n✅ Authentication successful!")

      // Auth-server writes tokens directly — no move needed.
      // Just read them back to confirm they exist with client credentials.
      if (existsSync(tokenPath)) {
        const tokens = JSON.parse(readFileSync(tokenPath, "utf8"))
        const env = readFileSync(".env", "utf8")

        const clientId = env.match(/CLIENT_ID=(.+)/)?.[1]
        const clientSecret = env.match(/CLIENT_SECRET=(.+)/)?.[1]
        const tenantId = env.match(/TENANT_ID=(.+)/)?.[1] || "organizations"

        // Merge credentials into the token file for future refreshes
        const enhancedTokens = {
          ...tokens,
          clientId,
          clientSecret,
          tenantId,
        }

        writeFileSync(tokenPath, JSON.stringify(enhancedTokens, null, 2))
        console.log(`\n📁 Tokens saved to: ${tokenPath}`)

        // Update Claude Desktop config
        await updateClaudeConfig()

        console.log("\n🎉 Setup complete! Microsoft To Do MCP is ready to use.")
        console.log("Restart Claude Desktop to activate the integration.")
      }
    } else {
      console.error("\n❌ Authentication failed. Please try again.")
    }

    rl.close()
  })
}

async function updateClaudeConfig() {
  const claudeConfigPath = getClaudeConfigPath()

  // Detect server command based on the local dist/ directory
  const serverCommand = detectServerCommand(__dirname)
  console.log(`Detected server command: ${serverCommand.command} ${serverCommand.args.join(" ")}`)

  const configEntry = generateClaudeConfigEntry(serverCommand)
  // configEntry intentionally has no `env` property — tokens come from
  // the platform-specific config dir, not from environment variables.

  if (!existsSync(claudeConfigPath)) {
    console.log("\n⚠️  Claude config not found. Add this to your Claude desktop config manually:")
    console.log(
      JSON.stringify(
        {
          "microsoft-todo": configEntry,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`Claude config path: ${claudeConfigPath}`)

  try {
    const config = JSON.parse(readFileSync(claudeConfigPath, "utf8"))

    // Add or update the microsoft-todo server config
    if (!config.mcpServers) {
      config.mcpServers = {}
    }

    config.mcpServers["microsoft-todo"] = configEntry

    writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2))
    console.log("\n✅ Updated Claude Desktop configuration")
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`\n⚠️  Could not update Claude config at ${claudeConfigPath}: ${msg}`)
  }
}

// Run setup
setup().catch(console.error)
