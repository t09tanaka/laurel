import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS, COMPLETIONS_SPEC } from '../specs.ts';

type Shell = 'bash' | 'zsh' | 'fish' | 'pwsh';

const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish', 'pwsh'];
const COMPLETION_COMMAND_ALIASES: Record<string, string> = { completion: 'completions' };
const SHELL_ALIASES: Record<string, Shell> = { powershell: 'pwsh' };

export async function runCompletions(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(COMPLETIONS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(COMPLETIONS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(COMPLETIONS_SPEC));
    return 0;
  }

  const [shellOrAction, installShellArg, ...extraArgs] = parsed.positionals;
  if (extraArgs.length > 0) {
    process.stderr.write(`Unexpected argument: ${extraArgs.join(' ')}\n`);
    return 2;
  }

  if (shellOrAction === 'install') {
    return installCompletions(parsed, installShellArg);
  }

  if (shellOrAction === undefined) {
    process.stderr.write('Missing shell argument. Expected one of: bash, zsh, fish, pwsh\n');
    return 2;
  }
  const shell = normalizeShell(shellOrAction);
  if (shell === undefined) {
    process.stderr.write(
      `Unsupported shell: ${shellOrAction}. Expected one of: bash, zsh, fish, pwsh\n`,
    );
    return 2;
  }

  process.stdout.write(renderCompletionScript(shell));
  return 0;
}

async function installCompletions(
  parsed: ParsedCommand,
  installShellArg?: string,
): Promise<number> {
  const requestedShell = installShellArg ?? stringValue(parsed.values.shell) ?? 'auto';
  const shell = resolveInstallShell(requestedShell, process.env);
  if (shell === undefined) {
    process.stderr.write(
      `Unsupported shell: ${requestedShell}. Expected one of: auto, bash, zsh, fish, pwsh\n`,
    );
    return 2;
  }
  if (shell === 'auto') {
    process.stderr.write(
      'Could not detect the current shell. Re-run with --shell bash, --shell zsh, --shell fish, or --shell pwsh.\n',
    );
    return 2;
  }

  const targetPath = completionInstallPath(shell, process.env);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, renderCompletionScript(shell), { mode: 0o644 });
  process.stdout.write(`Installed laurel ${shell} completions to ${targetPath}\n`);
  return 0;
}

function renderCompletionScript(shell: Shell): string {
  const commands = commandNamesWithCompletionAliases();
  const flags: Record<string, string[]> = {};
  for (const name of commands) {
    const spec = COMMAND_SPECS[canonicalCompletionCommand(name)];
    if (!spec) continue;
    flags[name] = Object.keys(spec.options).map((flag) => `--${flag}`);
    flags[name].push('--help');
  }

  switch (shell) {
    case 'bash':
      return renderBash(commands, flags);
    case 'zsh':
      return renderZsh(commands, flags);
    case 'fish':
      return renderFish(commands, flags);
    case 'pwsh':
      return renderPowerShell(commands, flags);
  }
}

function resolveInstallShell(input: string, env: NodeJS.ProcessEnv): Shell | 'auto' | undefined {
  const shell = input.toLowerCase();
  if (shell === 'auto') return detectShell(env) ?? 'auto';
  return normalizeShell(shell);
}

function normalizeShell(input: string): Shell | undefined {
  const shell = input.toLowerCase();
  const aliased = SHELL_ALIASES[shell];
  if (aliased !== undefined) return aliased;
  if ((SHELLS as readonly string[]).includes(shell)) return shell as Shell;
  return undefined;
}

function detectShell(env: NodeJS.ProcessEnv): Shell | undefined {
  const shellName = env.SHELL ? basename(env.SHELL).toLowerCase() : '';
  const shell = normalizeShell(shellName);
  if (shell !== undefined) return shell;
  if (process.platform === 'win32' || env.PSModulePath !== undefined) return 'pwsh';
  return undefined;
}

function completionInstallPath(shell: Shell, env: NodeJS.ProcessEnv): string {
  const home = homePath(env);
  const xdgDataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const xdgConfigHome = env.XDG_CONFIG_HOME || join(home, '.config');
  switch (shell) {
    case 'bash':
      return join(xdgDataHome, 'bash-completion', 'completions', 'laurel');
    case 'zsh':
      return join(env.ZDOTDIR || join(home, '.zsh'), 'completions', '_laurel');
    case 'fish':
      return join(xdgConfigHome, 'fish', 'completions', 'laurel.fish');
    case 'pwsh':
      if (process.platform === 'win32') {
        return join(env.USERPROFILE || home, 'Documents', 'PowerShell', 'laurel-completions.ps1');
      }
      return join(xdgConfigHome, 'powershell', 'laurel-completions.ps1');
  }
}

function homePath(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || homedir();
}

function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function commandNamesWithCompletionAliases(): string[] {
  const aliases = Object.keys(COMPLETION_COMMAND_ALIASES);
  return [...aliases, ...COMMAND_NAMES];
}

function canonicalCompletionCommand(name: string): string {
  return COMPLETION_COMMAND_ALIASES[name] ?? name;
}

function renderBash(commands: string[], flags: Record<string, string[]>): string {
  const cases = commands
    .map((name) => `      ${name})\n        opts="${(flags[name] ?? []).join(' ')}";;`)
    .join('\n');
  return `# laurel bash completion. Install with: laurel completions install --shell bash
_laurel_completions() {
  local cur prev cmd opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commands.join(' ')} help version" -- "$cur") )
    return 0
  fi
  cmd="\${COMP_WORDS[1]}"
  case "$cmd" in
${cases}
      *) opts="";;
  esac
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  return 0
}
complete -F _laurel_completions laurel
`;
}

function renderZsh(commands: string[], flags: Record<string, string[]>): string {
  const subFns = commands
    .map((name) => {
      const flagList = (flags[name] ?? []).map((f) => `'${f}'`).join(' ');
      return `__laurel_${name.replace(/-/g, '_')}() {
  _arguments -s -S ${flagList} ':*::: :->args'
}`;
    })
    .join('\n');
  const cmdList = commands.map((n) => {
    const spec = COMMAND_SPECS[canonicalCompletionCommand(n)];
    const summary = (spec?.summary ?? '').replace(/'/g, "'\\''");
    return `    '${n}:${summary}'`;
  });
  const cmdCases = commands
    .map((n) => `      ${n}) __laurel_${n.replace(/-/g, '_')} ;;`)
    .join('\n');
  return `#compdef laurel
# laurel zsh completion. Install with: laurel completions install --shell zsh
${subFns}
_laurel() {
  local context state state_descr line
  typeset -A opt_args
  _arguments -C \\
    '1: :->command' \\
    '*::: :->args'
  case $state in
    command)
      _values 'laurel command' \\
${cmdList.join(' \\\n')}
      ;;
    args)
      case $line[1] in
${cmdCases}
      esac
      ;;
  esac
}
_laurel "$@"
`;
}

function renderFish(commands: string[], flags: Record<string, string[]>): string {
  const lines: string[] = [];
  lines.push('# laurel fish completion. Install with: laurel completions install --shell fish.');
  lines.push(
    "complete -c laurel -n '__fish_use_subcommand' -a 'help version' -d 'Built-in command'",
  );
  for (const name of commands) {
    const spec = COMMAND_SPECS[canonicalCompletionCommand(name)];
    const summary = (spec?.summary ?? '').replace(/'/g, "\\'");
    lines.push(`complete -c laurel -n '__fish_use_subcommand' -a '${name}' -d '${summary}'`);
  }
  for (const name of commands) {
    for (const flag of flags[name] ?? []) {
      const bare = flag.replace(/^--/, '');
      lines.push(`complete -c laurel -n '__fish_seen_subcommand_from ${name}' -l ${bare}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderPowerShell(commands: string[], flags: Record<string, string[]>): string {
  const flagBranches = commands
    .map((name) => {
      const flagList = (flags[name] ?? []).map((f) => `'${f}'`).join(', ');
      return `    '${name}' { return @(${flagList}) }`;
    })
    .join('\n');
  return `# laurel PowerShell completion. Install with: laurel completions install --shell pwsh
Register-ArgumentCompleter -Native -CommandName laurel -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $tokens = $commandAst.CommandElements
  if ($tokens.Count -le 1) {
    @(${commands.map((c) => `'${c}'`).join(', ')}, 'help', 'version') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }
  $sub = [string]$tokens[1].Value
  $flags = switch ($sub) {
${flagBranches}
    default { @() }
  }
  $flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
  }
}
`;
}
