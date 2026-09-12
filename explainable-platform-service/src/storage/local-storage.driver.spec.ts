import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './local-storage.driver';

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'storage-'));
    driver = new LocalStorageDriver(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips a buffer through the same key', async () => {
    const payload = Buffer.from('{"contract_version":1}', 'utf8');
    const key = await driver.save('predictions/abc/explain.json.gz', payload);

    expect(key).toBe('predictions/abc/explain.json.gz');
    await expect(driver.download(key)).resolves.toEqual(payload);
  });

  it('creates nested directories for a key', async () => {
    await expect(
      driver.save('a/deeply/nested/key.bin', Buffer.from('x')),
    ).resolves.toBe('a/deeply/nested/key.bin');
  });

  it('overwrites an existing key rather than appending', async () => {
    await driver.save('k', Buffer.from('first'));
    await driver.save('k', Buffer.from('second'));
    await expect(driver.download('k')).resolves.toEqual(Buffer.from('second'));
  });

  it('streams back what was written', async () => {
    await driver.save('k', Buffer.from('hello'));

    const chunks: Buffer[] = [];
    const stream = driver.createReadStream('k');
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });

    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('refuses a key that would escape the storage root', async () => {
    await expect(
      driver.save('../../etc/passwd', Buffer.from('no')),
    ).rejects.toThrow(/outside/);
    expect(() => driver.createReadStream('../../etc/passwd')).toThrow(/outside/);
  });

  it('reports a missing key as a rejection, not a hang', async () => {
    await expect(driver.download('never-written')).rejects.toThrow();
  });
});
