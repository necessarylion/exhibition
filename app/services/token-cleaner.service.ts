import { singleton } from "tsyringe";
import { ADMIN_ACTION_KEEP_DAYS } from "../constants/admin-action.constants";
import { NOTIFICATION_KEEP_DAYS } from "../constants/notification.constants";
import { DAY_MS } from "../constants/time.constants";
import { AccessTokenRepository } from "../repositories/access-token.repository";
import { AdminActionRepository } from "../repositories/admin-action.repository";
import { NotificationRepository } from "../repositories/notification.repository";
import { Clock } from "./clock.service";

/**
 * Deletes expired login tokens, old notifications and old rows of the admin log: once at
 * the start, then once a day.
 */
// ponytail: a timer in this process. With many servers each one runs it, which is harmless.
// Move it to a cron job if the delete ever gets slow.
@singleton()
export class TokenCleaner {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly tokens: AccessTokenRepository,
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
    private readonly adminActions: AdminActionRepository,
  ) {}

  start(): void {
    void this.run();
    this.timer = setInterval(this.run.bind(this), DAY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** A failure is only logged. The next run tries again. */
  async run(): Promise<void> {
    try {
      // A token gets its dates from the real time. A notification gets its date from the clock.
      await this.tokens.deleteExpired(new Date().toISOString());
      await this.notifications.deleteOlderThan(
        new Date(this.clock.now() - NOTIFICATION_KEEP_DAYS * DAY_MS).toISOString(),
      );
      await this.adminActions.deleteOlderThan(
        new Date(this.clock.now() - ADMIN_ACTION_KEEP_DAYS * DAY_MS).toISOString(),
      );
    } catch (error) {
      console.error("Could not delete the expired tokens and the old rows.", error);
    }
  }
}
