import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS, COMPLETIONS_SPEC } from '../specs.ts';

type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish', 'powershell'];
const COMPLETION_COMMAND_ALIASES: Record<string, string> = { completion: 'completions' };

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

  const shellArg = parsed.positionals[0];
  if (shellArg === undefined) {
    process.stderr.write('Missing shell argument. Expected one of: bash, zsh, fish, powershell\n');
    return 2;
  }
  const shell = shellArg.toLowerCase();
  if (!isSupportedShell(shell)) {
    process.stderr.write(
      `Unsupported shell: ${shellArg}. Expected one of: bash, zsh, fish, powershell\n`,
    );
    return 2;
  }

  const commands = commandNamesWithCompletionAliases();
  const flags: Record<string, string[]> = {};
  for (const name of commands) {
    const spec = COMMAND_SPECS[canonicalCompletionCommand(name)];
    if (!spec) continue;
    flags[name] = Object.keys(spec.options).map((flag) => `--${flag}`);
    flags[name].push('--help');
  }

  let script: string;
  switch (shell) {
    case 'bash':
      script = renderBash(commands, flags);
      break;
    case 'zsh':
      script = renderZsh(commands, flags);
      break;
    case 'fish':
      script = renderFish(commands, flags);
      break;
    case 'powershell':
      script = renderPowerShell(commands, flags);
      break;
  }
  process.stdout.write(script);
  return 0;
}

function isSupportedShell(s: string): s is Shell {
  return (SHELLS as readonly string[]).includes(s);
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
  return `# nectar bash completion. Source this file or place it under /etc/bash_completion.d/.
_nectar_completions() {
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
complete -F _nectar_completions nectar
`;
}

function renderZsh(commands: string[], flags: Record<string, string[]>): string {
  const subFns = commands
    .map((name) => {
      const flagList = (flags[name] ?? []).map((f) => `'${f}'`).join(' ');
      return `__nectar_${name.replace(/-/g, '_')}() {
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
    .map((n) => `      ${n}) __nectar_${n.replace(/-/g, '_')} ;;`)
    .join('\n');
  return `#compdef nectar
# nectar zsh completion. Place under any directory in $fpath (e.g. /usr/local/share/zsh/site-functions/_nectar).
${subFns}
_nectar() {
  local context state state_descr line
  typeset -A opt_args
  _arguments -C \\
    '1: :->command' \\
    '*::: :->args'
  case $state in
    command)
      _values 'nectar command' \\
${cmdList.join(' \\\n')}
      ;;
    args)
      case $line[1] in
${cmdCases}
      esac
      ;;
  esac
}
_nectar "$@"
`;
}

function renderFish(commands: string[], flags: Record<string, string[]>): string {
  const lines: string[] = [];
  lines.push('# nectar fish completion. Place under ~/.config/fish/completions/nectar.fish.');
  lines.push(
    "complete -c nectar -n '__fish_use_subcommand' -a 'help version' -d 'Built-in command'",
  );
  for (const name of commands) {
    const spec = COMMAND_SPECS[canonicalCompletionCommand(name)];
    const summary = (spec?.summary ?? '').replace(/'/g, "\\'");
    lines.push(`complete -c nectar -n '__fish_use_subcommand' -a '${name}' -d '${summary}'`);
  }
  for (const name of commands) {
    for (const flag of flags[name] ?? []) {
      const bare = flag.replace(/^--/, '');
      lines.push(`complete -c nectar -n '__fish_seen_subcommand_from ${name}' -l ${bare}`);
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
  return `# nectar PowerShell completion. Save and dot-source in your $PROFILE.
Register-ArgumentCompleter -Native -CommandName nectar -ScriptBlock {
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
