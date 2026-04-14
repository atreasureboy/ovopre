export async function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
