import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from '../flow/identity.module.js'
import { CircleService } from './service.js'
import { CircleController } from './controller.js'
@Module({ imports: [DatabaseModule, IdentityModule], controllers: [CircleController], providers: [CircleService], exports: [CircleService] })
export class CircleModule {}
