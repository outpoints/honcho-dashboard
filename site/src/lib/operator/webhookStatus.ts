/** Queue completion is not a receipt from a webhook receiver. */
export function webhookQueueStatus(error: string | null, processed: boolean | null) {
  if (error !== null) return "failed";
  if (processed === true) return "processed";
  if (processed === false) return "pending";
  return "unknown";
}

export type WebhookQueueStatus = ReturnType<typeof webhookQueueStatus>;
