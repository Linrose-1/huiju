import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module.js'
import { RecommendationRecordsService } from './records.js'

@Module({ imports: [DatabaseModule], providers: [RecommendationRecordsService], exports: [RecommendationRecordsService] })
export class RecommendationRecordsModule {}
