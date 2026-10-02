import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'
import { IdentityModule } from './identity.module.js'
import { FlowController } from './controller.js'
import { OrganizerController } from './organizer-controller.js'
import { ReadingController } from './reading-controller.js'
import { ActivityService } from './activity.js'
import { OrganizerService } from './organizer.js'
import { ReadingService } from './reading.js'
import { ActivityModerationService } from './activity-moderation.js'
import { RecommendationCandidatesService } from './recommendation-candidates.js'
import { RecommendationRecordsModule } from '../recommendations/records.module.js'

// Capacity and registration writes remain in one transaction-owning module.
@Module({ imports: [DatabaseModule, IdentityModule, NotificationsModule, RecommendationRecordsModule],
  controllers: [FlowController, OrganizerController, ReadingController],
  providers: [ActivityService, OrganizerService, ReadingService, ActivityModerationService, RecommendationCandidatesService],
  exports: [ActivityModerationService, RecommendationCandidatesService, ReadingService] })
export class ActivitiesModule {}
