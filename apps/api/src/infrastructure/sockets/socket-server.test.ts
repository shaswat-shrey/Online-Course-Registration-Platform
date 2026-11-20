import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../database/prisma.js';
import { closeQueues } from '../queues/queues.js';
import { resetState } from '../../tests/db.js';
import { bearer, createUser, login } from '../../tests/factories.js';
import { getSocketEmitter, userRoom } from './socket-emitter.js';
import { attachSocketServer } from './socket-server.js';

const app = createApp();

describe('socket gateway', () => {
  const httpServer = createServer(express());
  const gateway = attachSocketServer(httpServer);
  let url = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });
  beforeEach(resetState);
  afterAll(async () => {
    await gateway.close();
    await closeQueues();
    await prisma.$disconnect();
  });

  function connectWith(token?: string) {
    return connect(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: token ? { token } : {},
    });
  }

  function connectError(token?: string) {
    const client = connectWith(token);
    return new Promise<{ message: string; data?: { code?: string } }>((resolve) =>
      client.on('connect_error', (e) => {
        client.close();
        resolve(e as never);
      }),
    );
  }

  it('rejects handshakes without a valid token', async () => {
    expect((await connectError()).data?.code).toBe('UNAUTHENTICATED');
    expect((await connectError('garbage')).data?.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid token and delivers events sent to the user room (including from workers)', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const client = connectWith(s.accessToken);
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    const received = new Promise((resolve) => client.on('notification:test', resolve));
    getSocketEmitter().to(userRoom(user.id)).emit('notification:test', { hello: 'world' });
    expect(await received).toEqual({ hello: 'world' });
    client.close();
  });

  it('rejects tokens of revoked sessions', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    await request(app).post('/api/v1/auth/logout-all').set(bearer(s)).expect(200);
    expect((await connectError(s.accessToken)).data?.code).toBe('SESSION_REVOKED');
  });
});
