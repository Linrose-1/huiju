import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { IdentityModule } from '../flow/identity.module.js'
import { ActivityDraftController } from './controller.js'
import { ActivityDraftService } from './service.js'
import { AgentIsHereDraftProvider } from './provider.js'
import { ActivitiesModule } from '../flow/activities.module.js'
import { RecommendationRecordsModule } from '../recommendations/records.module.js'
import { RecommendationProvider } from '../recommendations/provider.js'
import { ActivitySearchService } from '../recommendations/service.js'
import { ActivitySearchController } from '../recommendations/controller.js'

@Module({ imports: [DatabaseModule, IdentityModule, ActivitiesModule, RecommendationRecordsModule], controllers: [ActivityDraftController, ActivitySearchController],
  providers: [ActivityDraftService, AgentIsHereDraftProvider, RecommendationProvider, ActivitySearchService] })
export class AiModule {}
