/**
 * A file too big to go inside a call: ask for a private link, PUT the bytes straight
 * to storage, then save it with the upload_id (file.upload_url, file.upload).
 *
 * ⛔ The multipart route takes folder_path, never folder_id, so a file sent to it with a
 * folder landed outside that folder. Anything with --folder comes this way too.
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { apiClient } from './api-client';
import { unwrapVerb } from './verb-envelope';

/** Under this a file with no folder keeps going to the multipart route. */
export const LINK_ABOVE_BYTES = 5 * 1024 * 1024;

export function goesByLink(sizeBytes: number, folder?: string): boolean {
  return Boolean(folder) || sizeBytes > LINK_ABOVE_BYTES;
}

async function verb(name: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await apiClient.post(`/api/v1/agent/file/${name}`, body);
  const out = unwrapVerb(res.data) as Record<string, any>;
  if (out?.status === 'error') throw new Error(`${out.reason}: ${out.summary}`);
  return out;
}

export async function uploadByLink(filePath: string, folder?: string): Promise<Record<string, any>> {
  const filename = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const link = await verb('upload_url', { filename, size_bytes: size });
  if (typeof link.upload_url !== 'string' || !link.upload_id) {
    throw new Error('The server gave no upload link. Update the platform or send a file under 5 MB.');
  }
  await axios.put(link.upload_url, fs.createReadStream(filePath), {
    headers: link.headers, maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return verb('upload', {
    filename, upload_id: link.upload_id, confirm: true,
    ...(folder ? { folder_id: Number(folder) } : {}),
  });
}
