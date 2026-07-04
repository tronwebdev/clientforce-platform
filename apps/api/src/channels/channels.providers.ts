import type { Provider } from "@nestjs/common";
import { SendGridSender, type EmailSender } from "@clientforce/channels";

export const EMAIL_TRANSPORT = "CHANNELS_EMAIL_TRANSPORT";

export const channelsProviders: Provider[] = [
  // CF_MANAGED shared pool (SendGrid, sandbox until P1.8). Tests override.
  { provide: EMAIL_TRANSPORT, useFactory: (): EmailSender => new SendGridSender() },
];
