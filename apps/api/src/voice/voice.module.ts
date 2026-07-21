import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { VoiceController } from "./voice.controller";
import { voiceProviders } from "./voice.providers";

/**
 * P3.1 (DEC-078): the voice channel's API surface — dial (behind the FULL
 * rail order), the Calls tab reads, workspace voice defaults, and the Twilio
 * status callback. The media path itself lives in apps/voice.
 */
@Module({
  imports: [DbModule],
  controllers: [VoiceController],
  providers: voiceProviders,
})
export class VoiceModule {}
