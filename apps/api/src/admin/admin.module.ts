import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { ActivitiesModule } from '../flow/activities.module.js'
import { FeedbackModule } from '../flow/feedback.module.js'
import { AdminController } from './controller.js'
import { AdminModerationController } from './moderation-controller.js'
import { AdminMemberController } from './member-controller.js'
import { AdminActivityController } from './activity-controller.js'
import { AdminService } from './service.js'
import { CircleModule } from '../circle/circle.module.js'
import { AdminCircleController } from './circle-controller.js'
import { AdminMemberService } from './member-service.js'
import { AnalyticsController } from './analytics-controller.js'
import { AnalyticsService } from './analytics-service.js'
import { ActivityReportService } from './activity-report-service.js'

@Module({ imports: [DatabaseModule, ActivitiesModule, FeedbackModule, CircleModule],
  controllers: [AdminController, AdminModerationController, AdminMemberController, AdminActivityController, AdminCircleController, AnalyticsController],
  providers: [AdminService, AdminMemberService, AnalyticsService, ActivityReportService], exports: [AdminService] })
export class AdminModule {}
