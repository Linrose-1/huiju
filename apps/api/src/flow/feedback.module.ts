import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from './identity.module.js'
import { FeedbackController } from './feedback-controller.js'
import { FeedbackService } from './feedback.js'

@Module({ imports: [DatabaseModule, IdentityModule], controllers: [FeedbackController],
  providers: [FeedbackService], exports: [FeedbackService] })
export class FeedbackModule {}
