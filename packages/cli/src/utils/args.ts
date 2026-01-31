export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    if (trimmed.length === 0) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      options[key] = value;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      options[trimmed] = next;
      i += 1;
    } else {
      options[trimmed] = true;
    }
  }

  return { positionals, options };
}
