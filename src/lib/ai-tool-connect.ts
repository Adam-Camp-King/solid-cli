/**
 * `solid mcp connect <tool>` — the one-step "point my AI at this business".
 *
 * ⛔ WHY THIS IS NOT `solid connect`.
 *
 * `solid connect` is TAKEN and means something else entirely: importing
 * external DATA (Figma, Slack, Notion, WordPress, CSV, GitHub, Sheets, Docs).
 * Renaming a shipped public command would break every user's muscle memory and
 * every doc line that names it, to save one word. This lives under the existing
 * `solid mcp` namespace instead, next to `mcp install`, which is where someone
 * looking for it will already be.
 *
 * ⛔ AND WHY IT IS NOT JUST AN ALIAS FOR `solid mcp install`.
 *
 * There are TWO transports and they are not interchangeable:
 *
 *   STDIO      `npx @solidnumber/mcp` with a static SOLID_API_KEY in the
 *              client's config file. Local, no browser, works offline-ish.
 *              ⚠️ The tenant comes from the KEY RECORD, not from the CLI
 *              session — `solid switch` does NOT move it. An agent wired this
 *              way keeps answering about whichever company the key belongs to,
 *              confidently, after the human has switched away.
 *
 *   CONNECTOR  https://api.solidnumber.com/mcp/connector over OAuth. No CLI,
 *              no npm, no key on disk; the person authorizes in a browser and
 *              picks the company then. This is the ONLY option for the
 *              browser-only tools (ChatGPT, Grok, Genspark, Manus, claude.ai)
 *              and it is the better default for everyone else.
 *
 * `mcp install` only ever spoke the first one. A user whose AI is ChatGPT had
 * no documented path at all, and a user with no `claude` binary hit
 * `command not found` with no guidance — the installer says it "wires Claude
 * Code", which runs `claude mcp add` and no-ops silently when claude is absent.
 *
 * Pure module: no fs, no network, no process. The command layer does I/O.
 */
import { McpClient } from './mcp-client-config';

export const CONNECTOR_URL = 'https://api.solidnumber.com/mcp/connector';

/** How a tool gets wired up. */
export type ConnectMethod =
  /** We can write the client's config file ourselves. */
  | 'config'
  /** Browser/GUI only — we can print the exact steps, not perform them. */
  | 'manual';

export interface AiTool {
  id: string;
  label: string;
  method: ConnectMethod;
  /** Which config file to write, when method === 'config'. */
  client?: McpClient;
  /** Transport the instructions describe. */
  transport: 'stdio' | 'connector';
  /** Exact, ordered steps a human follows. */
  steps: string[];
  /** Caveats that will otherwise become a support ticket. */
  notes?: string[];
  /** A prerequisite binary that must exist first, if any. */
  requiresBinary?: string;
  /** What to tell them when `requiresBinary` is missing. */
  installHint?: string;
}

const CONNECTOR_STEPS = (menuPath: string): string[] => [
  `Open ${menuPath}`,
  `Add a custom / remote MCP server`,
  `Paste this URL:  ${CONNECTOR_URL}`,
  `Sign in with your Solid# account and authorize`,
  `Choose the company, and grant read (or read + write)`,
];

/**
 * ⛔ ORDER IS THE PRODUCT. A new user reads the first entry and stops, so the
 * no-install browser path leads. The tools that need something installed come
 * after, because recommending them first is what produces `command not found`.
 */
export const AI_TOOLS: AiTool[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    method: 'manual',
    transport: 'connector',
    steps: CONNECTOR_STEPS('ChatGPT → Settings → Connectors'),
    notes: [
      'Custom connectors are gated by plan and may need developer mode — a free account often cannot see the option.',
    ],
  },
  {
    id: 'claude-web',
    label: 'Claude (claude.ai / desktop app)',
    method: 'manual',
    transport: 'connector',
    steps: CONNECTOR_STEPS('Claude → Settings → Connectors'),
    notes: [
      'This is the browser/app path and needs nothing installed. For Claude CODE in a terminal, use `solid mcp connect claude-code`.',
    ],
  },
  {
    id: 'grok',
    label: 'Grok',
    method: 'manual',
    transport: 'connector',
    steps: CONNECTOR_STEPS('Grok → Settings → Connections / Integrations'),
    notes: ['If Grok exposes no custom-MCP option on your plan, there is no connection path yet — say so rather than guessing.'],
  },
  {
    id: 'genspark',
    label: 'Genspark',
    method: 'manual',
    transport: 'connector',
    steps: CONNECTOR_STEPS('Genspark → Settings → Integrations / MCP'),
    notes: ['Not yet verified end-to-end by us. The URL is standard remote MCP; if Genspark speaks it, it works.'],
  },
  {
    id: 'manus',
    label: 'Manus',
    method: 'manual',
    transport: 'connector',
    steps: CONNECTOR_STEPS('Manus → Settings → Integrations / MCP'),
    notes: ['Not yet verified end-to-end by us. The URL is standard remote MCP; if Manus speaks it, it works.'],
  },
  {
    id: 'claude-code',
    label: 'Claude Code (terminal)',
    method: 'manual',
    transport: 'connector',
    requiresBinary: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    steps: [
      `claude mcp add --transport http solidnumber ${CONNECTOR_URL}`,
      'claude',
      'Authorize in the browser when prompted',
    ],
    notes: [
      'Claude Code is a separate program. The Solid# installer does NOT install it — it only wires it up if it is already there.',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    method: 'config',
    client: 'cursor',
    transport: 'stdio',
    steps: ['solid mcp install cursor', 'Restart Cursor', 'Ask it: "list solid tools"'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    method: 'config',
    client: 'windsurf',
    transport: 'stdio',
    steps: ['solid mcp install windsurf', 'Restart Windsurf', 'Ask it: "list solid tools"'],
  },
  {
    id: 'vscode',
    label: 'VS Code (Claude Code extension)',
    method: 'config',
    client: 'vscode',
    transport: 'stdio',
    steps: ['solid mcp install vscode', 'Reload VS Code', 'Ask it: "list solid tools"'],
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop (local MCP server)',
    method: 'config',
    client: 'claude',
    transport: 'stdio',
    steps: ['solid mcp install claude', 'Quit and relaunch Claude Desktop', 'Ask it: "list solid tools"'],
    notes: ['Prefer `claude-web` unless you specifically want the local server — the connector needs no key on disk.'],
  },
  {
    id: 'other',
    label: 'Anything else that speaks MCP',
    method: 'manual',
    transport: 'connector',
    steps: [
      'Point your tool at this remote MCP URL:',
      `  ${CONNECTOR_URL}`,
      'It will run OAuth and ask which company to use.',
    ],
    notes: ['If your tool speaks MCP, this is the whole integration. No CLI and no `claude` binary required.'],
  },
];

export function findTool(id: string | undefined | null): AiTool | undefined {
  if (!id) return undefined;
  const needle = String(id).trim().toLowerCase();
  return (
    AI_TOOLS.find((t) => t.id === needle) ||
    // Forgiving aliases — a user types what they call the thing, not our id.
    AI_TOOLS.find((t) => ALIASES[needle] === t.id)
  );
}

/**
 * Aliases exist because the failure mode is a dead end, not a typo message.
 * "gpt" must not print "unknown tool" when chatgpt is right there.
 */
export const ALIASES: Record<string, string> = {
  gpt: 'chatgpt',
  openai: 'chatgpt',
  'chat-gpt': 'chatgpt',
  claude: 'claude-web',
  'claude-ai': 'claude-web',
  claudecode: 'claude-code',
  'claude-cli': 'claude-code',
  code: 'claude-code',
  xai: 'grok',
  gemini: 'other',
  mcp: 'other',
  generic: 'other',
};

export function toolIds(): string[] {
  return AI_TOOLS.map((t) => t.id);
}
