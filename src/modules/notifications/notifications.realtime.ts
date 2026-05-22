import {
  NOTIFICATION_WEBSOCKET_EVENTS,
} from "./notifications.constants";

type NotificationSocket = {
  readyState?: number;
  send: (payload: string) => void;
  close?: (code?: number, reason?: string) => void;
};

class NotificationsRealtimeHub {
  private readonly socketsByUser = new Map<number, Set<NotificationSocket>>();

  subscribe(userId: number, socket: NotificationSocket): void {
    const sockets = this.socketsByUser.get(userId) ?? new Set<NotificationSocket>();
    sockets.add(socket);
    this.socketsByUser.set(userId, sockets);
  }

  unsubscribe(userId: number, socket: NotificationSocket): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  activeConnectionCount(): number {
    let total = 0;
    for (const sockets of this.socketsByUser.values()) {
      total += sockets.size;
    }
    return total;
  }

  publishSummary(userId: number, payload: unknown): void {
    this.publish(userId, NOTIFICATION_WEBSOCKET_EVENTS.SUMMARY, payload);
  }

  publishActivityCreated(userId: number, payload: unknown): void {
    this.publish(userId, NOTIFICATION_WEBSOCKET_EVENTS.ACTIVITY_CREATED, payload);
  }

  publishActivityUpdated(userId: number, payload: unknown): void {
    this.publish(userId, NOTIFICATION_WEBSOCKET_EVENTS.ACTIVITY_UPDATED, payload);
  }

  private publish(userId: number, type: string, payload: unknown): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets || sockets.size === 0) return;

    const message = JSON.stringify({
      type,
      payload,
      createdAt: new Date().toISOString(),
    });

    for (const socket of sockets) {
      if (typeof socket.readyState === "number" && socket.readyState !== 1) {
        continue;
      }
      try {
        socket.send(message);
      } catch {
        // Best effort only.
      }
    }
  }
}

export const notificationsRealtimeHub = new NotificationsRealtimeHub();
