import { Module } from '@nestjs/common'
import { APP_FILTER, APP_PIPE } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { FlowController } from './flow/controller.js'
import { FlowDatabase, SafeExceptionFilter } from './flow/common.js'
import { WechatAdapter } from './flow/wechat.js'
import { IdentityService } from './flow/identity.js'
import { ActivityService } from './flow/activity.js'
@Module({
  controllers: [HealthController, FlowController],
  providers: [FlowDatabase,WechatAdapter,IdentityService,ActivityService,{provide:APP_FILTER,useClass:SafeExceptionFilter},{provide:APP_PIPE,useValue:new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})}],
})
export class AppModule {}
