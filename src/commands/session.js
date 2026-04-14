import {
  deleteSession,
  listSessions,
  loadSession,
  readSessionMeta
} from '../core/sessionStore.js';

export async function runSessionCommand(args) {
  const [action = 'list', ...rest] = args;

  if (action === 'list') {
    const sessions = await listSessions();
    if (!sessions.length) {
      console.log('No sessions found.');
      return;
    }

    for (const s of sessions) {
      console.log(`${s.sessionId}\t${s.updatedAt}\t${s.sizeBytes}B`);
    }
    return;
  }

  if (action === 'show') {
    const sessionId = rest[0];
    if (!sessionId) {
      throw new Error('Usage: ovopre session show <sessionId>');
    }
    const meta = await readSessionMeta(sessionId);
    const messages = await loadSession(sessionId);
    console.log(JSON.stringify({ ...meta, messages }, null, 2));
    return;
  }

  if (action === 'rm' || action === 'delete') {
    const sessionId = rest[0];
    if (!sessionId) {
      throw new Error('Usage: ovopre session rm <sessionId>');
    }
    await deleteSession(sessionId);
    console.log(`Deleted session: ${sessionId}`);
    return;
  }

  throw new Error(`Unknown session action: ${action}`);
}
