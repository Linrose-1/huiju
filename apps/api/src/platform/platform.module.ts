import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module.js'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from '../flow/identity.module.js'
import { AdminPlatformController, PlatformController } from './controller.js'
import { PlatformService } from './service.js'
import { AdminBrandController, PublicBrandAppearanceController, PublicBrandController } from './brand-controller.js'
import { BrandService } from './brand-service.js'
import { AdminMcpController } from './mcp-controller.js'
import { McpSettingsService } from './mcp-service.js'

@Module({ imports: [DatabaseModule, IdentityModule, AdminModule], controllers: [PlatformController, AdminPlatformController, PublicBrandController, PublicBrandAppearanceController, AdminBrandController, AdminMcpController], providers: [PlatformService, BrandService, McpSettingsService] })
export class PlatformModule {}
