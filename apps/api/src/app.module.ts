import { Module } from '@nestjs/common'
import { APP_FILTER, APP_PIPE } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { SafeExceptionFilter } from './common/errors.js'
import { ActivitiesModule } from './flow/activities.module.js'
import { FeedbackModule } from './flow/feedback.module.js'
import { AdminModule } from './admin/admin.module.js'
import { AiModule } from './ai/ai.module.js'
import { CircleModule } from './circle/circle.module.js'
@Module({
  imports: [ActivitiesModule, FeedbackModule, AdminModule, AiModule, CircleModule],
  controllers: [HealthController],
  providers: [{provide:APP_FILTER,useClass:SafeExceptionFilter},{provide:APP_PIPE,useValue:new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})}],
})
export class AppModule {}
