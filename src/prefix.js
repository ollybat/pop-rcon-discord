/** Message-command parsing: "!pop 2" -> { name: 'pop', args: ['2'] }. */
export function parsePrefixCommand(content, prefix = '!') {
  const text = String(content ?? '').trim();
  if (!text || !prefix || !text.startsWith(prefix)) return null;

  const body = text.slice(prefix.length).trim();
  if (!body) return null;

  const [name, ...args] = body.split(/\s+/);
  if (!name) return null;
  return { name: name.toLowerCase(), args };
}

export function prefixHelp(command, prefix = '!') {
  return command.prefixUsage ?? prefix + command.name;
}
