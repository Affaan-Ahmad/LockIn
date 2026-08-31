import type { Logger } from '@/shared/logger';
import { PersistenceError } from '@/shared/errors';

/**
 * Account deletion.
 *
 * The reason this is a real service rather than a `DELETE` against a table:
 * deleting a student's account has to reach outside our database. Google still
 * holds a grant that we asked for, and leaving it behind means the student has
 * "deleted" their account while we retain standing authorisation to read their
 * coursework. Revocation is part of deletion, not a nicety alongside it.
 *
 * Everything else falls out of the schema. Every user-owned table cascades from
 * `user_profiles`, which cascades from `auth.users`, so removing the auth user
 * removes the lot in one transaction. That is deliberate: a hand-written list
 * of tables to clear is a list that silently goes stale the next time a table is
 * added, and the failure mode is orphaned personal data nobody notices.
 */

export interface AuthUserDeleter {
  deleteUser(userId: string): Promise<void>;
}

export interface GoogleDisconnector {
  disconnect(userId: string): Promise<{ revokedAtGoogle: boolean }>;
}

export interface AccountServiceDeps {
  readonly authUsers: AuthUserDeleter;
  readonly google: GoogleDisconnector;
  readonly logger: Logger;
}

export interface DeletionResult {
  readonly userId: string;
  readonly googleRevoked: boolean;
  readonly deletedAt: Date;
}

export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  /**
   * Deletes the account and everything belonging to it.
   *
   * Order is load-bearing. Google is revoked first, while the credentials still
   * exist to revoke with; deleting the user first would destroy the refresh
   * token and strand a live grant we could no longer withdraw.
   *
   * A failed revocation does not abort the deletion. Refusing to delete because
   * Google was briefly unreachable would trap a student in an account they
   * asked to remove -- and privacy law does not accept "the third party was
   * down" as a reason to keep processing their data. The orphaned grant is
   * logged, and the student can also revoke it from their Google account page.
   */
  async deleteAccount(userId: string): Promise<DeletionResult> {
    const { deps } = this;
    const logger = deps.logger.child({ userId, operation: 'account.delete' });

    logger.info('account deletion requested');

    let googleRevoked = false;
    try {
      const outcome = await deps.google.disconnect(userId);
      googleRevoked = outcome.revokedAtGoogle;
    } catch (cause) {
      logger.error('google revocation failed during account deletion; continuing', {
        message: cause instanceof Error ? cause.message : 'unknown',
      });
    }

    try {
      await deps.authUsers.deleteUser(userId);
    } catch (cause) {
      // If this fails the account still exists, so the caller must be told
      // plainly rather than shown a success screen over a half-finished delete.
      throw new PersistenceError('Account deletion failed; no data was removed', {
        cause,
        context: { userId, googleRevoked },
      });
    }

    logger.info('account deleted', { googleRevoked });

    return { userId, googleRevoked, deletedAt: new Date() };
  }
}
