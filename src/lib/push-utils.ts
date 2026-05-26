/**
 * Pure functions for the push command — no CLI deps (ora/chalk/commander).
 * Testable in isolation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PullManifest } from './tenant-guard';

export interface ChangeSet {
  pages: { file: string; action: 'create' | 'update'; data: Record<string, unknown> }[];
  kb: { file: string; action: 'create' | 'update'; data: { title: string; content: string; category: string; id?: number } }[];
  settings: { changed: boolean; data: Record<string, unknown> };
  summary: { creates: number; updates: number; settings: boolean };
}

export function parseKbMarkdown(content: string): { id?: number; title: string; category: string; content: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { title: 'Untitled', category: 'general', content: content.trim() };
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  let id: number | undefined;
  let title = 'Untitled';
  let category = 'general';

  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':').trim();

    if (key.trim() === 'id') id = parseInt(value, 10);
    if (key.trim() === 'title') title = value.replace(/^["']|["']$/g, '');
    if (key.trim() === 'category') category = value;
  }

  return { id, title, category, content: body };
}

export function detectChanges(baseDir: string, manifest: PullManifest): ChangeSet {
  const changes: ChangeSet = {
    pages: [],
    kb: [],
    settings: { changed: false, data: {} },
    summary: { creates: 0, updates: 0, settings: false },
  };

  const pagesDir = path.join(baseDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    const pageFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'));

    for (const file of pageFiles) {
      const filePath = path.join(pagesDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (manifest.pages[file]) {
        changes.pages.push({ file, action: 'update', data: content });
        changes.summary.updates++;
      } else {
        changes.pages.push({ file, action: 'create', data: content });
        changes.summary.creates++;
      }
    }
  }

  const kbDir = path.join(baseDir, 'kb');
  if (fs.existsSync(kbDir)) {
    const kbFiles = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md'));

    for (const file of kbFiles) {
      const filePath = path.join(kbDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseKbMarkdown(raw);

      if (manifest.kb[file]) {
        changes.kb.push({
          file,
          action: 'update',
          data: { ...parsed, id: manifest.kb[file].id },
        });
        changes.summary.updates++;
      } else {
        changes.kb.push({ file, action: 'create', data: parsed });
        changes.summary.creates++;
      }
    }
  }

  const configPath = path.join(baseDir, 'solid.config.json');
  if (fs.existsSync(configPath)) {
    const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (localConfig.website_settings && Object.keys(localConfig.website_settings).length > 0) {
      changes.settings = { changed: true, data: localConfig.website_settings };
      changes.summary.settings = true;
    }
  }

  return changes;
}
