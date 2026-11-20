import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachSocketServer } from './socket-server.js';

describe('socket gateway', () => {
  const httpServer = createServer();
  const gateway = attachSocketServer(httpServer);
  let url = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await gateway.close();
  });

  it('rejects handshakes without authentication', async () => {
    const client = connect(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'anything' },
    });
    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) =>
      client.on('connect_error', resolve),
    );
    client.close();
    expect(error.message).toBe('Authentication required');
    expect(error.data?.code).toBe('UNAUTHENTICATED');
  });
});
