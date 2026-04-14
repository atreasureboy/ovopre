export function parseArgs(argv) {
  const raw = argv.slice(2);
  const flags = new Map();
  const positionals = [];

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token.startsWith('--')) {
      const [key, inlineValue] = token.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(key, inlineValue);
        continue;
      }

      const next = raw[i + 1];
      if (next && !next.startsWith('-')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const chars = token.slice(1).split('');
      for (const ch of chars) {
        flags.set(`-${ch}`, true);
      }
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

export function hasFlag(flags, ...names) {
  return names.some((name) => flags.has(name));
}

export function getFlagValue(flags, ...names) {
  for (const name of names) {
    const value = flags.get(name);
    if (value !== undefined && value !== true) {
      return String(value);
    }
  }
  return undefined;
}
