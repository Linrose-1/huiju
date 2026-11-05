import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module.js'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from '../flow/identity.module.js'
import { AdminPlatformController, PlatformController } from './controller.js'
import { PlatformService } from './service.js'
import { AdminBrandController, PublicBrandController } from './brand-controller.js'
import { BrandService } from './brand-service.js'

@Module({ imports: [DatabaseModule, IdentityModule, AdminModule], controllers: [PlatformController, AdminPlatformController, PublicBrandController, AdminBrandController], providers: [PlatformService, BrandService] })
export class PlatformModule {}
