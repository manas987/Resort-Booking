/**
 * The only simulated external message delivery (Docs/04-contracts.md). Mock, deterministic
 * success — same "no documented failure trigger" shape as 1H's refund/apology path. IB-14
 * arranges a failed `delivery_status` directly in the database, the same arrangement
 * convention already used for `setRoomDay`, `tax_config`, and simulated admin rate changes
 * (Docs/09-test-harness.md).
 */
export async function deliverMessage(input: {
  messageId: string;
  channel: 'website' | 'email' | 'whatsapp';
}): Promise<{ status: 'sent' | 'failed'; error?: string }> {
  void input;
  return { status: 'sent' };
}
