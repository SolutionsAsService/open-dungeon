/**
 * Miniatures served by the server (ADR 0011): the private library sources configured with MINI_LIBRARY_SOURCES
 * (server/minisources.ts, Node only, injected by server/main.ts). Every call checks campaign membership; meshes
 * are only served to members, never as public static files.
 */
import type { Services } from './services';
import { notFound } from './errors';
import type { MiniItem } from '../shared/minis';

export class MiniService {
  constructor(private svc: Services) {}

  private async role(userId: string, campaignId: string) {
    const role = await this.svc.roleFor(userId, campaignId);
    if (!role) throw notFound('Campaign not found');
    return role;
  }

  async list(userId: string, campaignId: string): Promise<{ library: MiniItem[] }> {
    await this.role(userId, campaignId);
    return { library: (await this.svc.opts.miniLibrary?.library()) ?? [] };
  }

  /** Parts mesh JSON (name, colour, vertices, triangles) for a library miniature. */
  async mesh(userId: string, campaignId: string, miniId: string): Promise<Buffer> {
    await this.role(userId, campaignId);
    const data = await this.svc.opts.miniLibrary?.mesh(miniId);
    if (!data) throw notFound('Miniature not found');
    return data;
  }
}
