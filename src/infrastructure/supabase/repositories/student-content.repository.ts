import 'server-only';

import type {
  AssignmentNoteRepository,
  UserEventRepository,
} from '@/application/ports/repositories';
import type {
  AssignmentNote,
  UserEvent,
  UserEventDraft,
} from '@/domain/student-content/types';
import { NotFoundError } from '@/shared/errors';

import type { AppSupabaseClient } from '../clients';
import type { AssignmentNoteRow, UserEventRow } from '../database.types';
import { translatePostgrestError } from './shared';

/**
 * Storage for the two things the student authors.
 *
 * Both are read and written under the user-scoped client, so row-level security
 * is the floor under every statement here. The explicit `user_id` filters are
 * the first lock, not the only one.
 */

export class SupabaseAssignmentNoteRepository implements AssignmentNoteRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  async set(userId: string, assignmentId: string, body: string): Promise<AssignmentNote> {
    // Through the RPC, not a bare upsert. The assignment id comes from the
    // caller and carries a foreign key, and a foreign key is verified as the
    // table owner -- outside the caller's policies. Written directly, another
    // student's id would succeed where an imaginary one failed, which is an
    // existence oracle. app_set_assignment_note requires ownership and answers
    // P0002 either way. See 0015, and 0014 for the bug this pattern came from.
    const { data, error } = await this.db.rpc('app_set_assignment_note', {
      p_user_id: userId,
      p_assignment_id: assignmentId,
      p_body: body,
    });

    if (error !== null) throw translatePostgrestError(error, 'notes.set');

    // PostgREST is not dependable about whether a composite return arrives as an
    // object or a one-element array; normalised the same way the override and
    // sync repositories are.
    const row = Array.isArray(data) ? data[0] : data;
    if (row === undefined || row === null || typeof row.id !== 'string') {
      throw new NotFoundError('Note was not persisted');
    }

    return toNote(row);
  }

  async clear(userId: string, assignmentId: string): Promise<void> {
    // A plain delete is safe where the upsert was not: a delete matching no rows
    // succeeds silently, so it cannot distinguish "not yours" from "not there".
    const { error } = await this.db
      .from('assignment_notes')
      .delete()
      .eq('user_id', userId)
      .eq('assignment_id', assignmentId);

    if (error !== null) throw translatePostgrestError(error, 'notes.clear');
  }

  async listByAssignment(userId: string): Promise<ReadonlyMap<string, AssignmentNote>> {
    const { data, error } = await this.db
      .from('assignment_notes')
      .select('assignment_id, body, updated_at')
      .eq('user_id', userId);

    if (error !== null) throw translatePostgrestError(error, 'notes.list');

    // A map, because every caller is asking "does this assignment have a note?"
    // once per row it renders. Returning an array would make that a scan per
    // assignment.
    return new Map(
      (data ?? []).map((row) => [row.assignment_id, toNote(row as AssignmentNoteRow)]),
    );
  }
}

function toNote(row: Pick<AssignmentNoteRow, 'assignment_id' | 'body' | 'updated_at'>): AssignmentNote {
  return {
    assignmentId: row.assignment_id,
    body: row.body,
    updatedAt: new Date(row.updated_at),
  };
}

export class SupabaseUserEventRepository implements UserEventRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  async create(userId: string, draft: UserEventDraft): Promise<UserEvent> {
    const { data, error } = await this.db
      .from('user_events')
      .insert({
        user_id: userId,
        title: draft.title,
        kind: draft.kind,
        starts_at: draft.startsAt.toISOString(),
        note: draft.note,
      })
      .select('id, title, kind, starts_at, note')
      .single();

    if (error !== null) throw translatePostgrestError(error, 'events.create');
    if (data === null) throw new NotFoundError('Event was not persisted');

    return toEvent(data);
  }

  async delete(userId: string, eventId: string): Promise<void> {
    // Scoped by user_id as well as id. RLS would refuse another user's row
    // anyway; this makes the intent legible at the call site rather than
    // relying on a policy the reader has to go and look up.
    const { error } = await this.db
      .from('user_events')
      .delete()
      .eq('user_id', userId)
      .eq('id', eventId);

    if (error !== null) throw translatePostgrestError(error, 'events.delete');
  }

  async listUpcoming(userId: string, from: Date, limit: number): Promise<readonly UserEvent[]> {
    const { data, error } = await this.db
      .from('user_events')
      .select('id, title, kind, starts_at, note')
      .eq('user_id', userId)
      .gte('starts_at', from.toISOString())
      .order('starts_at', { ascending: true })
      .limit(limit);

    if (error !== null) throw translatePostgrestError(error, 'events.list');

    return (data ?? []).map((row) => toEvent(row));
  }
}

function toEvent(row: Pick<UserEventRow, 'id' | 'title' | 'kind' | 'starts_at' | 'note'>): UserEvent {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    startsAt: new Date(row.starts_at),
    note: row.note,
  };
}
