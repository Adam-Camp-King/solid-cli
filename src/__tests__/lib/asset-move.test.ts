/** Our copy goes only after the saved copy is proved; `save` never asks for that. */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

const post = jest.fn();
const get = jest.fn();
jest.mock('../../lib/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

import { saveAsset } from '../../lib/asset-move';

const wrap = (result: unknown) => ({ data: { ok: true, verb: 'v', result } });
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'am-')), 'a.mp4');

describe('moving an asset', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    get.mockResolvedValue({ data: Readable.from([Buffer.from('hello')]) });
  });

  it('proves the saved copy before asking to remove ours', async () => {
    post.mockResolvedValueOnce(wrap({ status: 'OK', download_url: 'https://x/a', filename: 'a.mp4' }));
    post.mockResolvedValueOnce(wrap({ status: 'OK', bytes_removed: true }));
    await saveAsset('ast_1', out, false);
    expect(post.mock.calls[0][0]).toContain('/asset/move_to_device');
    expect(post.mock.calls[1][0]).toContain('/asset/delete_after_saved');
    expect(post.mock.calls[1][1]).toMatchObject({
      size_bytes: 5, md5: createHash('md5').update('hello').digest('hex'),
    });
  });

  it('save keeps our copy and never asks to remove it', async () => {
    post.mockResolvedValueOnce(wrap({ status: 'OK', download_url: 'https://x/a', filename: 'a.mp4' }));
    const done = await saveAsset('ast_1', out, true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(done.kept).toBe(true);
  });

  it('a refusal stops before anything is saved', async () => {
    post.mockResolvedValueOnce(wrap({ status: 'ERROR', error: 'asset_in_use', detail: 'A page uses it.' }));
    await expect(saveAsset('ast_1', out, false)).rejects.toThrow('asset_in_use');
    expect(get).not.toHaveBeenCalled();
  });

  it('a failed download never asks to remove ours', async () => {
    post.mockResolvedValueOnce(wrap({ status: 'OK', download_url: 'https://x/a', filename: 'a.mp4' }));
    get.mockRejectedValueOnce(new Error('dropped'));
    await expect(saveAsset('ast_1', out, false)).rejects.toThrow('dropped');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
