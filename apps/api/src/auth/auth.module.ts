import { Module } from "@nestjs/common";
import { tokenVerifierProvider } from "./auth.providers";

@Module({
  providers: [tokenVerifierProvider],
  exports: [tokenVerifierProvider],
})
export class AuthModule {}
