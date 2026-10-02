import { Module } from '@nestjs/common'
import { FlowDatabase } from './service.js'

@Module({ providers: [FlowDatabase], exports: [FlowDatabase] })
export class DatabaseModule {}
