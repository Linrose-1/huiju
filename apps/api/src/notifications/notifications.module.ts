import { Module } from '@nestjs/common'
import { NotificationDelivery } from './delivery.js'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from '../flow/identity.module.js'
import { NotificationService } from './service.js'
import { NotificationController } from './controller.js'

@Module({ imports: [DatabaseModule, IdentityModule], controllers: [NotificationController],
  providers: [NotificationDelivery, NotificationService], exports: [NotificationDelivery, NotificationService] })
export class NotificationsModule {}
