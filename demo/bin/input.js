import { Buffer } from 'node:buffer';

/**
 * Forward one WebSocket message without interpreting binary data as UTF-8 or
 * resize JSON. Text input/control messages retain the demo's existing protocol.
 * node-pty's platform implementations pass Buffer writes to their input sockets.
 */
export function forwardTerminalInput(pty, data, isBinary) {
  const bytes = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data);
  if (isBinary) {
    pty.write(bytes);
    return;
  }

  const message = bytes.toString('utf8');
  if (message.startsWith('{')) {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'resize') {
        pty.resize(msg.cols, msg.rows);
        return;
      }
    } catch {
      // Not a valid resize control message: preserve it as ordinary input.
    }
  }
  pty.write(message);
}
