export interface NotificationRow {
  id: string;
  user_id: string;
  text: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

/** A short message for one user, shown inside the app. */
export class Notification {
  constructor(
    readonly id: string,
    readonly userId: string,
    readonly text: string,
    /** The page that opens when the user clicks it. */
    readonly link: string,
    readonly createdAt: string,
    readonly readAt: string | null = null,
  ) {}

  static fromRow(row: NotificationRow): Notification {
    return new Notification(row.id, row.user_id, row.text, row.link, row.created_at, row.read_at);
  }

  toPublic() {
    return {
      id: this.id,
      text: this.text,
      link: this.link,
      readAt: this.readAt,
      createdAt: this.createdAt,
    };
  }
}
