import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { Device, User } from '@app/database';
import { subDays } from 'date-fns';

const GRACE_DAYS = 30;

/**
 * Second half of the soft-delete flow:
 *   1. `DELETE /v1/users/me` marks `user.deletedAt = now` and scrubs PII
 *   2. This task, running daily (k8s CronJob), finds users whose `deletedAt`
 *      is older than {@link GRACE_DAYS} and hard-deletes them + every owned
 *      document.
 *
 * The grace window lets support revive an accidentally-deleted account.
 *
 * Deletes are batched but NOT transactional — child collections run first,
 * then the user, so a partial failure leaves an "orphan-free user" state that
 * re-running cleans up safely. List every owned collection in `purgeUser` so
 * future entities without a back-ref don't get silently left behind.
 */
@Injectable()
export class UserPurgeTask {
  private readonly logger = new Logger(UserPurgeTask.name);

  constructor(private readonly em: EntityManager) {}

  async run(): Promise<{ purged: number }> {
    const cutoff = subDays(new Date(), GRACE_DAYS);
    const victims = await this.em.find(
      User,
      { deletedAt: { $lt: cutoff } },
      { fields: ['_id'] },
    );

    if (victims.length === 0) {
      this.logger.log(`No users past the ${GRACE_DAYS}-day grace window`);
      return { purged: 0 };
    }

    this.logger.log(`Purging ${victims.length} soft-deleted user(s)`);

    let purged = 0;
    for (const victim of victims) {
      try {
        await this.purgeUser(victim._id);
        purged++;
      } catch (err) {
        // Keep going — one bad row shouldn't stop the whole sweep. The next
        // run retries the same user.
        this.logger.error(
          `failed to purge userId=${victim._id.toHexString()}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Purge complete: ${purged}/${victims.length} users`);
    return { purged };
  }

  private async purgeUser(userId: ObjectId): Promise<void> {
    // Children first, then the user. Add your own owned collections here.
    await this.em.nativeDelete(Device, { userId });
    await this.em.nativeDelete(User, { _id: userId });
  }
}
