import { OrganizerController } from './flow/organizer-controller.js'
import { OrganizerService } from './flow/organizer.js'
import { Module } from '@nestjs/common'
import { APP_FILTER, APP_PIPE } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { FlowController } from './flow/controller.js'
import { FlowDatabase, SafeExceptionFilter } from './flow/common.js'
import { WechatAdapter } from './flow/wechat.js'
import { IdentityService } from './flow/identity.js'
import { ActivityService } from './flow/activity.js'
import { ReadingController } from './flow/reading-controller.js'
import { ReadingService } from './flow/reading.js'
import { MemberCardController } from './flow/member-card-controller.js'
import { MemberCardService } from './flow/member-card.js'
@Module({
  controllers: [HealthController, FlowController, OrganizerController, ReadingController, MemberCardController],
  providers: [MemberCardService,ReadingService,OrganizerService,FlowDatabase,WechatAdapter,IdentityService,ActivityService,{provide:APP_FILTER,useClass:SafeExceptionFilter},{provide:APP_PIPE,useValue:new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})}],
})
export class AppModule {}
