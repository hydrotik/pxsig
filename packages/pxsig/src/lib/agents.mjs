/**
 * agents.mjs — which coding assistant, if any, started this process, from the environment only.
 *
 * Each row is a variable an assistant sets in the shell it runs commands in, and that a person's own
 * terminal does not have. Variables an editor sets in every terminal (TERM_PROGRAM, VSCODE_*,
 * ZED_TERM, CURSOR_TRACE_ID) are not markers: a person's terminal has them too (decision 9.1).
 *
 * A marker is a hint, not proof. Any process can set or unset a variable, and some assistants set
 * none (Zed, Aider, Continue, Windsurf as far as is known). The uses are an early refusal that names
 * the assistant, plain output, and `agent` on log lines; the reviewed pull request is the guarantee.
 *
 * Nothing here starts a program or reads a file: the environment is the only input.
 */

/** The name a value may contribute: letters, digits, dot, dash and underscore, at most 64. */
const clean = (v) => String(v).replace(/[^\w.-]/g, '_').slice(0, 64);
const set = (env, k) => env[k] != null && env[k] !== '';

/**
 * In order; the first row that matches names the assistant. `name` is a string, or a function of
 * the matching value. Sources were read on 2026-10-25.
 */
export const MARKERS = [
  // pxsig's own: set it in any shell an assistant uses.
  { vars: ['PXSIG_AGENT'], name: (v) => (v === '1' || v === 'true' ? 'agent' : clean(v)) },
  // The cross-vendor variable: VS Code Copilot agent mode (github_copilot_vscode_agent), Claude Code,
  // opencode. https://github.com/microsoft/vscode/blob/main/src/vs/platform/chat/common/aiAgentEnv.ts
  // Known values get the short name the other rows use; any other value is its own name.
  { vars: ['AI_AGENT'], name: (v) => (/^github_copilot/.test(v) ? 'copilot' : /^claude-code/.test(v) ? 'claude-code' : clean(v)) },
  // VS Code agent mode keeps COPILOT_AGENT for back-compat; Copilot CLI sets COPILOT_CLI and, on
  // shell-tool commands, COPILOT_AGENT_SESSION_ID (npm @github/copilot@1.0.60).
  { vars: ['COPILOT_AGENT', 'COPILOT_CLI', 'COPILOT_AGENT_SESSION_ID'], name: 'copilot' },
  // https://code.claude.com/docs/en/env-vars (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION); the entry
  // point is observed. CLAUDECODE is also set in the IDE extensions' integrated terminals.
  { vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION'], name: 'claude-code' },
  // https://github.com/openai/codex/blob/main/codex-rs/core/src/spawn.rs and exec_env.rs: the
  // thread id and CODEX_CI always; the sandbox variables only under the macOS sandbox.
  { vars: ['CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'], name: 'codex' },
  // https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/shellExecutionService.ts
  { vars: ['GEMINI_CLI'], name: 'gemini-cli' },
  // https://cursor.com/docs/agent/tools/terminal, https://cursor.com/docs/agent/security/run-modes
  { vars: ['CURSOR_AGENT', 'CURSOR_SANDBOX'], name: 'cursor' },
  // Cline's VS Code terminal mode only (the default):
  // https://github.com/cline/cline/blob/main/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts
  { vars: ['CLINE_ACTIVE'], name: 'cline' },
  // Roo Code's VS Code terminal mode only:
  // https://github.com/RooCodeInc/Roo-Code/blob/main/src/integrations/terminal/Terminal.ts
  { vars: ['ROO_ACTIVE'], name: 'roo-code' },
  // npm @sourcegraph/amp (2026-06-09 build). AGENT counts only with the value amp.
  { vars: ['AGENT'], when: (v) => v === 'amp', name: 'amp' },
  { vars: ['AMP_CURRENT_THREAD_ID'], name: 'amp' },
  // https://github.com/sst/opencode packages/core/src/tool/plugin/shell.ts
  { vars: ['OPENCODE'], name: 'opencode' },
];

/** Set in a person's terminals too, so never a marker. Listed for the docs and the tests. */
export const NOT_MARKERS = ['TERM_PROGRAM', 'VSCODE_INJECTION', 'VSCODE_GIT_ASKPASS_NODE', 'GIT_ASKPASS', 'ZED_TERM', 'CURSOR_TRACE_ID'];

/**
 * The assistant this environment names: `{ name, variable, value }`, or null. `value` is cleaned
 * the same way as a name, so it is safe to print and to log.
 */
export function detectAgent(env = process.env) {
  for (const row of MARKERS)
    for (const k of row.vars) {
      if (!set(env, k)) continue;
      const v = env[k];
      if (row.when && !row.when(v)) continue;
      return { name: typeof row.name === 'function' ? row.name(v) : row.name, variable: k, value: clean(v) };
    }
  return null;
}

/** The assistant's name, or null. */
export const agentName = (env = process.env) => detectAgent(env)?.name ?? null;

/** "copilot (AI_AGENT=github_copilot_vscode_agent)", for refusals and `doctor`. */
export const describeAgent = (a) => (a ? `${a.name} (${a.variable}=${a.value})` : null);
