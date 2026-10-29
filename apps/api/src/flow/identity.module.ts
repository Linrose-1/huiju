import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityService } from './identity.js'
import { WechatAdapter } from './wechat.js'
import { MemberCardController } from './member-card-controller.js'
import { MemberCardService } from './member-card.js'
import { IdentityController } from './identity-controller.js'
import { FellowsController } from './fellows-controller.js'
import { FellowsService } from './fellows.js'

@Module({ imports: [DatabaseModule], controllers: [IdentityController, MemberCardController, FellowsController],
  providers: [IdentityService, WechatAdapter, MemberCardService, FellowsService], exports: [IdentityService, WechatAdapter] })
export class IdentityModule {}
