import { mkdir, readFile, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

// One serialized, atomic checkpoint per company, on the Railway persistent volume.
// Auth failures propagate: never silently replace a corrupt session with new credentials.
export async function persistentAuthState(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'auth.json');
  let stored;
  try { stored = JSON.parse(await readFile(filename, 'utf8'), BufferJSON.reviver); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const creds = stored?.creds || initAuthCreds();
  const keys = stored?.keys || {};
  let pending = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    const operation = pending.then(async () => {
      const temporary = filename + '.tmp';
      const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(snapshot); await file.sync(); } finally { await file.close(); }
      await rename(temporary, filename);
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    });
    pending = operation;
    return operation;
  };
  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            if (value !== undefined) result[id] = value;
          }
          return result;
        },
        async set(data) {
          for (const [type, values] of Object.entries(data)) {
            keys[type] ||= {};
            for (const [id, value] of Object.entries(values)) {
              if (value == null) delete keys[type][id]; else keys[type][id] = value;
            }
          }
          await persist();
        }
      }
    },
    saveCreds: persist,
    flush: () => pending
  };
}
