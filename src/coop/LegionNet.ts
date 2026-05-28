// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 3: Supabase Realtime transport
//
// Implements LegionNetTransport over Supabase Realtime channels. The room
// CODE is the channel name (legion:<CODE>). Presence tracks the roster;
// broadcast carries game messages (leak manifests, Rome updates, etc.).
// No DB tables, no RLS — Realtime broadcast + presence work with just the
// anon key, so the lobby is fully serverless (fits GitHub Pages hosting).
//
// supabase-js is dynamically imported so it lands in the lazy /coop chunk,
// never the base bundle. Reuses the same VITE_SUPABASE_* env as the
// leaderboard service.
// ─────────────────────────────────────────────────────────────────────

import type { LegionNetTransport, LegionNetMessage, LegionPlayer } from './LegionTypes';
import type { QuadrantId } from './LegionConfig';

const SUPABASE_URL = ((import.meta as any).env?.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '').trim();

export function isRealtimeConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Unambiguous room-code alphabet (no 0/O, 1/I/L to avoid mis-typing).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateRoomCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Stable per-tab id, persisted so a refresh can reconnect (Section 10.3). */
export function getOrCreateSelfId(): string {
  const KEY = 'legion_self_id';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) { id = 'p_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(KEY, id); }
    return id;
  } catch {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }
}

interface PresenceMeta {
  id: string;
  name: string;
  quadrant: QuadrantId | null;
  isHost: boolean;
}

export interface CreateTransportOpts {
  roomCode: string;
  self: { id: string; name: string };
  isHost: boolean;
}

/**
 * Create a live Supabase Realtime transport for a room. Resolves once the
 * channel is subscribed and self-presence is tracked. Throws if Realtime
 * isn't configured (caller should fall back to the local transport).
 */
export async function createRealtimeTransport(opts: CreateTransportOpts): Promise<LegionNetTransport> {
  if (!isRealtimeConfigured()) throw new Error('Supabase Realtime not configured');

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const channelName = `legion:${opts.roomCode}`;
  const channel = client.channel(channelName, {
    config: {
      presence: { key: opts.self.id },
      broadcast: { self: false, ack: false },
    },
  });

  // Message handlers keyed by message type. 'presence' is a synthetic type
  // emitted whenever the roster changes so the lobby can re-render.
  const handlers = new Map<string, ((m: LegionNetMessage) => void)[]>();
  const emit = (type: string, msg: LegionNetMessage) => {
    (handlers.get(type) ?? []).forEach((h) => { try { h(msg); } catch (e) { console.error('[legion-net] handler error', e); } });
  };

  let roster: LegionPlayer[] = [];
  const rebuildRoster = () => {
    const state = channel.presenceState() as Record<string, PresenceMeta[]>;
    roster = Object.values(state).map((metas) => {
      const m = metas[0];
      return { id: m.id, name: m.name, quadrant: m.quadrant ?? null, isHost: m.isHost, connected: true, ghost: false };
    });
    emit('presence', { type: 'presence', from: opts.self.id, payload: roster });
  };

  channel.on('presence', { event: 'sync' }, rebuildRoster);
  channel.on('presence', { event: 'join' }, rebuildRoster);
  channel.on('presence', { event: 'leave' }, rebuildRoster);
  channel.on('broadcast', { event: 'msg' }, (e: any) => {
    const m = e.payload as LegionNetMessage;
    if (m && typeof m.type === 'string') emit(m.type, m);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscribe timed out')), 10000);
    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        await channel.track({ id: opts.self.id, name: opts.self.name, quadrant: null, isHost: opts.isHost } as PresenceMeta);
        rebuildRoster();
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        reject(new Error(`Realtime channel ${status}`));
      }
    });
  });

  return {
    roomCode: opts.roomCode,
    selfId: opts.self.id,
    isHost: opts.isHost,
    send(type: string, payload: unknown) {
      channel.send({ type: 'broadcast', event: 'msg', payload: { type, from: opts.self.id, payload } });
    },
    on(type: string, handler: (m: LegionNetMessage) => void) {
      const arr = handlers.get(type) ?? [];
      arr.push(handler);
      handlers.set(type, arr);
    },
    presence() { return roster; },
    // Re-track presence (used to publish quadrant assignment changes).
    leave() {
      try { channel.unsubscribe(); client.removeChannel(channel); } catch { /* ignore */ }
    },
    // Custom extension: update self presence meta (quadrant assignment).
    updateSelf(meta: Partial<PresenceMeta>) {
      const cur = (channel.presenceState() as Record<string, PresenceMeta[]>)[opts.self.id]?.[0]
        ?? { id: opts.self.id, name: opts.self.name, quadrant: null, isHost: opts.isHost };
      channel.track({ ...cur, ...meta });
    },
  } as LegionNetTransport & { updateSelf(meta: Partial<PresenceMeta>): void };
}

// ─── LOCAL FALLBACK TRANSPORT ──────────────────────────────────────────
// Single-client in-memory transport for environments where Realtime isn't
// configured (or for solo UI testing). The lobby flow works, but only the
// local player exists — no real multiplayer. Clearly labeled so it's never
// mistaken for a live room.
export function createLocalTransport(opts: CreateTransportOpts): LegionNetTransport {
  const handlers = new Map<string, ((m: LegionNetMessage) => void)[]>();
  const self: LegionPlayer = {
    id: opts.self.id, name: opts.self.name, quadrant: null,
    isHost: opts.isHost, connected: true, ghost: false,
  };
  return {
    roomCode: opts.roomCode,
    selfId: opts.self.id,
    isHost: opts.isHost,
    send(type, payload) {
      // Echo back to self only (loopback) so single-client flows resolve.
      (handlers.get(type) ?? []).forEach((h) => h({ type, from: opts.self.id, payload }));
    },
    on(type, handler) {
      const arr = handlers.get(type) ?? []; arr.push(handler); handlers.set(type, arr);
    },
    presence() { return [self]; },
    leave() { /* no-op */ },
  };
}
