/** The bytes go to the link, and the file is saved by upload_id into its folder. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const post = jest.fn();
const put = jest.fn();
jest.mock('../../lib/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }));
jest.mock('axios', () => ({ __esModule: true, default: { put: (...a: unknown[]) => put(...a) } }));

import { goesByLink, LINK_ABOVE_BYTES, uploadByLink } from '../../lib/file-transfer';

const wrap = (verb: string, result: unknown) => ({ data: { ok: true, verb, result } });

describe('file transfer', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-')), 'clip.mp4');
  beforeAll(() => fs.writeFileSync(file, 'abc'));
  beforeEach(() => { post.mockReset(); put.mockReset(); });

  it('sends a big file or a foldered file by link, a small loose one by the route', () => {
    expect(goesByLink(LINK_ABOVE_BYTES + 1)).toBe(true);
    expect(goesByLink(10, '1')).toBe(true);
    expect(goesByLink(10)).toBe(false);
  });

  it('asks for exactly this size, PUTs to the link, saves into the folder', async () => {
    post.mockResolvedValueOnce(wrap('file.upload_url', {
      status: 'ok', upload_id: 'u1', upload_url: 'https://store/x', headers: { 'Content-Length': '3' },
    }));
    post.mockResolvedValueOnce(wrap('file.upload', { status: 'uploaded', file_id: 9, folder_id: 1 }));
    const out = await uploadByLink(file, '1');
    expect(post.mock.calls[0]).toEqual(['/api/v1/agent/file/upload_url', { filename: 'clip.mp4', size_bytes: 3 }]);
    expect(put.mock.calls[0][0]).toBe('https://store/x');
    expect(put.mock.calls[0][2].headers).toEqual({ 'Content-Length': '3' });
    expect(post.mock.calls[1]).toEqual(['/api/v1/agent/file/upload',
      { filename: 'clip.mp4', upload_id: 'u1', confirm: true, folder_id: 1 }]);
    expect(out.file_id).toBe(9);
  });

  it('stops on a refusal and sends no bytes', async () => {
    post.mockResolvedValueOnce(wrap('file.upload_url', { status: 'error', reason: 'quota_exceeded', summary: 'full' }));
    await expect(uploadByLink(file)).rejects.toThrow('quota_exceeded');
    expect(put).not.toHaveBeenCalled();
  });
});
