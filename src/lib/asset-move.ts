/**
 * Move a stored image or video onto this computer: save it, prove the saved copy by its size
 * and MD5, and only then ask for our copy to be removed. Keeping our copy is `keepCopy`.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { apiClient } from './api-client';
import { unwrapVerb } from './verb-envelope';

async function verb(name: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await apiClient.post(`/api/v1/agent/asset/${name}`, body);
  const out = unwrapVerb(res.data) as Record<string, any>;
  if (out?.status === 'ERROR') throw new Error(`${out.error}: ${out.detail ?? ''}`.trim());
  return out;
}

async function md5Of(file: string): Promise<string> {
  const hash = createHash('md5');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export async function saveAsset(assetId: string, outPath: string | undefined, keepCopy: boolean): Promise<Record<string, any>> {
  const link = await verb(keepCopy ? 'download_url' : 'move_to_device', { asset_id: assetId });
  if (typeof link.download_url !== 'string') throw new Error('The server gave no link. Update the platform.');
  const target = outPath ?? path.join(process.cwd(), path.basename(link.filename ?? assetId));
  const res = await axios.get(link.download_url, { responseType: 'stream', maxContentLength: Infinity });
  await pipeline(res.data, fs.createWriteStream(target));
  if (keepCopy) return { saved: target, kept: true };
  const size = fs.statSync(target).size;
  const done = await verb('delete_after_saved', {
    asset_id: assetId, size_bytes: size, md5: await md5Of(target), confirm: true,
  });
  return { saved: target, kept: false, ...done };
}
