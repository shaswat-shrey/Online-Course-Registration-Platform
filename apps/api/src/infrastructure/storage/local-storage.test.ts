import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../database/prisma.js';
import { storage, assertSafeKey, sanitizeFilename, type LocalStorageService } from './index.js';

const app = createApp();
const local = storage as LocalStorageService;

afterAll(() => prisma.$disconnect());

describe('storage key and filename safety', () => {
  it('rejects traversal and malformed keys', () => {
    for (const key of ['../etc/passwd', 'a/../../b', '/abs', 'UPPER', 'a//b', '']) {
      expect(() => assertSafeKey(key), key).toThrow();
    }
    expect(() => assertSafeKey('materials/2026/0b7e-file.pdf')).not.toThrow();
  });

  it('sanitizes header-breaking filename characters', () => {
    expect(sanitizeFilename('a"b\r\nc/d.pdf')).toBe('a_b__c_d.pdf');
    expect(sanitizeFilename('')).toBe('download');
  });
});

describe('local storage signed URLs', () => {
  it('uses the local driver in tests', () => {
    expect(storage.driver).toBe('local');
  });

  it('rejects tampered and expired tokens', () => {
    const token = local.sign({ op: 'get', key: 'x/y', exp: Math.floor(Date.now() / 1000) + 60 });
    expect(local.verify(token)).not.toBeNull();
    const [body, mac] = token.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ op: 'get', key: 'x/other', exp: 9999999999 }),
    ).toString('base64url');
    expect(local.verify(`${tampered}.${mac}`)).toBeNull();
    expect(local.verify(`${body}.AAAA`)).toBeNull();
    const expired = local.sign({ op: 'get', key: 'x/y', exp: Math.floor(Date.now() / 1000) - 1 });
    expect(local.verify(expired)).toBeNull();
  });

  it('uploads through a presigned PUT and downloads through a presigned GET', async () => {
    const key = 'tests/hello.txt';
    const upload = await storage.createUploadUrl(key, { contentType: 'text/plain', maxBytes: 100 });
    const uploadPath = new URL(upload.url).pathname;
    await request(app)
      .put(uploadPath)
      .set('Content-Type', 'text/plain')
      .send('hello world')
      .expect(204);

    expect(await storage.headObject(key)).toEqual({ size: 11, contentType: 'text/plain' });
    expect((await storage.getObjectHead(key, 5)).toString()).toBe('hello');

    const url = await storage.createDownloadUrl(key, { filename: 'greeting.txt' });
    const res = await request(app).get(new URL(url).pathname).expect(200);
    expect(res.text).toBe('hello world');
    expect(res.headers['content-disposition']).toBe('attachment; filename="greeting.txt"');

    await storage.deleteObject(key);
    expect(await storage.headObject(key)).toBeNull();
  });

  it('refuses uploads with the wrong content type or above the size limit', async () => {
    const upload = await storage.createUploadUrl('tests/limit.bin', {
      contentType: 'text/plain',
      maxBytes: 4,
    });
    const path = new URL(upload.url).pathname;
    const wrongType = await request(app)
      .put(path)
      .set('Content-Type', 'text/html')
      .send('abc')
      .expect(422);
    expect(wrongType.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const tooBig = await request(app)
      .put(path)
      .set('Content-Type', 'text/plain')
      .send('abcdefgh')
      .expect(422);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await storage.headObject('tests/limit.bin')).toBeNull();
  });

  it('does not accept a download token for uploads', async () => {
    const url = await storage.createDownloadUrl('tests/whatever.txt');
    await request(app)
      .put(new URL(url).pathname)
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(404);
  });
});
