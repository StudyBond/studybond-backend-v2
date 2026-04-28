import { SubscriptionService } from '../modules/subscriptions/subscriptions.service';

export async function runSubscriptionExpiryCheck(): Promise<{ expiredUsers: number }> {
  const subscriptionService = new SubscriptionService();
  const expiredUsers = await subscriptionService.expireDueSubscriptions();
  return { expiredUsers };
}
