import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenantClient } from "./tenant-client";

@Module({
  providers: [PrismaService, TenantClient],
  exports: [PrismaService, TenantClient],
})
export class DbModule {}
