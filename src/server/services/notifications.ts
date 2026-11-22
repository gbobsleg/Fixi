import type { AppContext } from '../context.js';

/**
 * Sends the admin alert e-mail for a freshly received report.
 * Placeholder in lot 1: the SMTP connector is plugged in during lot 4.
 */
export async function notifyNewReport(_ctx: AppContext, _reportId: number): Promise<void> {
  // no-op for now
}
