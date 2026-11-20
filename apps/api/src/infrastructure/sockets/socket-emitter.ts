import { Emitter } from '@socket.io/redis-emitter';
import { createQueueConnection } from '../redis/redis.js';

let emitter: Emitter | undefined;

/** Lets worker processes push events to connected clients through Redis. */
export function getSocketEmitter(): Emitter {
  emitter ??= new Emitter(createQueueConnection('socket-emitter'));
  return emitter;
}

export const userRoom = (userId: string) => `user:${userId}`;
