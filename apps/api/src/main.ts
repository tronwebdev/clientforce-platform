import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // INT W2 (DEC-094): rawBody preserves the exact wire bytes for webhook
  // signature verification (Calendly HMAC over "<t>.<rawBody>"). Additive:
  // body parsing is unchanged; existing webhook controllers keep reading the
  // parsed @Body() exactly as before.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port} (GET /healthz)`);
}

void bootstrap();
