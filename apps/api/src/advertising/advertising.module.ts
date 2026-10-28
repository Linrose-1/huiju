import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module.js'
import { DatabaseModule } from '../database/database.module.js'
import { AdvertisingController, AdminAdvertisingController } from './controller.js'
import { AdvertisingService } from './service.js'
@Module({imports:[DatabaseModule,AdminModule],controllers:[AdvertisingController,AdminAdvertisingController],providers:[AdvertisingService]})
export class AdvertisingModule {}
